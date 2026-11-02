using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.Native.World;

/// <summary>
/// Repairs to the church models that light and dressing cannot make (#224, #227), at load, beside the baked shells:
/// - Sint-Paulus' north portal (church_stpaul_4) was a deep stone reveal closed by a flat stone back: the outer face of
///   the church hall's own north wall (ROOM_stpaul gh_wash, z 247.56, with the Lady altar's marble back behind it; the
///   painted arch at z 248.04 stands inside the hall, behind that wall). A pair of oak leaves now hangs at the back of
///   the reveal, against that wall, vertical boards cut to the pointed arch, three forged strap hinges a leaf with their nails and
///   pintles, a ring pull, a lock plate and a beaded meeting strip (the town's oak door paint and wall iron: no new kind).
/// - Sint-Jacob's churchyard wall (church_stjacob_6) stopped in a flat top with two sharp arrises: it takes a blue-stone
///   coping, saddle-backed and weathered, 50 mm over each face, in lengths of 0.75-1.1 m with mortar joints and worn
///   arrises (the wall's own stone material).
/// (dev: --no-church-repairs leaves the churches as baked, for a before-and-after)
/// </summary>
public static class NativeChurchRepairs
{
    public const string Meta = "native_church_repairs";
    private const string DoorModel = "res://assets/models/shopfronts/church_door_r.res";
    private const string IronMaterial = "res://world/town/resources/r000615.res";
    private const string BlueStone = "res://world/town/resources/r001008.res";

    public static (int Doors, int Copings) Install(Node3D town)
    {
        var holder = new Node3D { Name = "church_repairs" };
        holder.SetMeta(Meta, true);
        town.AddChild(holder);
        int doors = PaulusNorthDoor(holder) ? 1 : 0;
        int copings = JacobWallCoping(holder);
        foreach (var n in Scheldemist.World.BakedWorld.All(holder)) n.SetMeta(Meta, true);
        return (doors, copings);
    }

    // ------------------------------------------------------------------ Sint-Paulus' north door

    // the painted arch in the north portal (church_stpaul_4, triangles 20-26): 2.8 m wide on the face z 248.04, its sill at
    // y 0.15, springing at 3.52 and its point at 5.60 (a drop arch of seven straight pieces, as the stone reveal round it)
    // (the leaves hang at the back of the reveal, 2 cm off the hall's north wall (its outer face at z 247.56, the stone
    // back seen from the street); the painted face lies 0.48 m further in, inside the hall behind the Lady altar)
    private static readonly Vector3 DoorAt = new(94.97f, 0.15f, 248.04f - 0.5f);
    private static readonly Vector2[] Arch = { new(1.40f, 3.373f), new(1.227f, 4.236f), new(0.735f, 4.966f), new(0f, 5.45f) };
    // the door's oak (church_door_r's paint: OAK x PAINT_K in repair-shopfronts.py) and the wall iron's colour
    private static readonly Color Oak = new(0.0816f, 0.0476f, 0.0272f);
    private static readonly Color Iron = new(0.42f, 0.4f, 0.37f);
    private const float LeafT = 0.07f, Gap = 0.003f;

    private static float ArchTop(float x)
    {
        float a = Math.Abs(x);
        for (int i = 0; i + 1 < Arch.Length; i++)
        {
            var (p, q) = (Arch[i], Arch[i + 1]);
            if (a <= p.X && a >= q.X) return Mathf.Lerp(p.Y, q.Y, (p.X - a) / (p.X - q.X));
        }
        return a > Arch[0].X ? Arch[0].Y : Arch[^1].Y;
    }

    private static bool PaulusNorthDoor(Node3D holder)
    {
        var model = ResourceLoader.Load<Mesh>(DoorModel);
        var oak = model?.GetSurfaceCount() > 0 ? model.SurfaceGetMaterial(0) : null;
        var iron = ResourceLoader.Load<Material>(IronMaterial);
        if (oak == null || iron == null) return false;
        // the door's frame: x to the right as seen from the street (north), y up, z out of the wall (to -z)
        var xf = new Transform3D(new Basis(new Vector3(-1, 0, 0), Vector3.Up, new Vector3(0, 0, -1)), DoorAt);
        var wood = new Builder(xf); var metal = new Builder(xf);
        var rng = new Random(1517);
        const float half = 1.40f - Gap;
        foreach (int side in new[] { -1, 1 })
        {
            // seven boards a leaf, each its own oak, a little proud or back of its neighbours; their front arrises chamfered 4 mm
            // (so each joint reads as a V), their tops cut to the arch
            float x0 = side < 0 ? -half : Gap, x1 = side < 0 ? -Gap : half, bw = (x1 - x0) / 7;
            for (int b = 0; b < 7; b++)
            {
                float bx0 = x0 + b * bw, bx1 = bx0 + bw;
                var outline = new List<Vector2> { new(bx0, 0.004f), new(bx1, 0.004f), new(bx1, ArchTop(bx1) - Gap) };
                foreach (var k in Arch.Concat(Arch.Select(p => new Vector2(-p.X, p.Y))).Where(p => p.X > bx0 + 0.001f && p.X < bx1 - 0.001f).OrderByDescending(p => p.X))
                    outline.Add(new Vector2(k.X, k.Y - Gap));
                outline.Add(new Vector2(bx0, ArchTop(bx0) - Gap));
                float tone = 0.82f + 0.3f * (float)rng.NextDouble(), proud = ((float)rng.NextDouble() - 0.5f) * 0.004f;
                // (darker at the foot, where the rain splashes and the boots kick)
                Color Col(Vector2 p) { float k = tone * (p.Y < 0.3f ? 0.72f + 0.93f * p.Y : 1f); return new Color(Oak.R * k, Oak.G * k, Oak.B * k); }
                wood.Prism(outline.ToArray(), 0.002f, LeafT + proud, 0.004f, Col, new Vector2((float)rng.NextDouble() * 3, 0), 1.5f);
            }
            // the strap hinges: forged bars 60 mm wide from the hinge edge most of the way across, ending in a spear; a nail
            // every 130 mm; the pintle's knuckle at the jamb
            float hx = side < 0 ? -half : half;
            foreach (float y in new[] { 0.62f, 1.95f, 3.05f })
            {
                float len = 1.06f, w = 0.03f, tip = hx - side * len;
                var bar = new[] { new Vector2(hx, y - w), new Vector2(tip + side * 0.05f, y - w), new Vector2(tip + side * 0.05f, y + w), new Vector2(hx, y + w) };
                if (side > 0) Array.Reverse(bar);
                metal.Prism(bar, LeafT - 0.002f, LeafT + 0.009f, 0.002f, _ => Iron, Vector2.Zero, 1);
                var spear = new[] { new Vector2(tip + side * 0.06f, y - 0.055f), new Vector2(tip, y), new Vector2(tip + side * 0.06f, y + 0.055f), new Vector2(tip + side * 0.11f, y) };
                if (side > 0) Array.Reverse(spear);
                metal.Prism(spear, LeafT - 0.002f, LeafT + 0.008f, 0.002f, _ => Iron, Vector2.Zero, 1);
                for (float s = 0.06f; s < len - 0.08f; s += 0.13f) metal.Stud(new Vector3(hx - side * s, y, LeafT + 0.009f), 0.009f, 0.006f, Iron);
                metal.Knuckle(new Vector3(hx + side * 0.004f, y, LeafT * 0.5f), 0.022f, 0.11f, Iron);
            }
        }
        // the meeting strip on the right-hand leaf, over the joint, beaded and cut to the point
        var strip = new[] { new Vector2(-0.032f, 0.004f), new Vector2(0.034f, 0.004f), new Vector2(0.034f, ArchTop(0.034f) - Gap - 0.02f), new Vector2(0f, ArchTop(0f) - Gap - 0.02f), new Vector2(-0.032f, ArchTop(-0.032f) - Gap - 0.02f) };
        wood.Prism(strip, LeafT, LeafT + 0.022f, 0.004f, p => new Color(Oak.R * 0.95f, Oak.G * 0.95f, Oak.B * 0.95f), new Vector2(0.4f, 0), 1.5f);
        // the ring pull on the right-hand leaf: an octagonal rose, the ring hanging flat against the boards
        var rose = Enumerable.Range(0, 8).Select(i => new Vector2(0.17f + 0.055f * MathF.Cos(i * MathF.Tau / 8 + 0.39f), 1.18f + 0.055f * MathF.Sin(i * MathF.Tau / 8 + 0.39f))).ToArray();
        metal.Prism(rose, LeafT - 0.002f, LeafT + 0.007f, 0.002f, _ => Iron, Vector2.Zero, 1);
        metal.Stud(new Vector3(0.17f, 1.18f, LeafT + 0.007f), 0.016f, 0.02f, Iron);
        metal.Ring(new Vector3(0.17f, 1.18f - 0.075f, LeafT + 0.016f), 0.075f, 0.009f, Iron);
        // the lock plate on the left-hand leaf, its keyhole dark
        var plate = new[] { new Vector2(-0.16f, 1.06f), new Vector2(-0.09f, 1.06f), new Vector2(-0.09f, 1.24f), new Vector2(-0.16f, 1.24f) };
        metal.Prism(plate, LeafT - 0.002f, LeafT + 0.005f, 0.0015f, _ => Iron, Vector2.Zero, 1);
        var hole = new[] { new Vector2(-0.131f, 1.1f), new Vector2(-0.119f, 1.1f), new Vector2(-0.119f, 1.16f), new Vector2(-0.131f, 1.16f) };
        metal.Prism(hole, LeafT + 0.005f, LeafT + 0.0055f, 0.0005f, _ => new Color(0.02f, 0.02f, 0.02f), Vector2.Zero, 1);
        foreach (float y in new[] { 1.07f, 1.23f }) metal.Stud(new Vector3(-0.125f, y, LeafT + 0.005f), 0.006f, 0.004f, Iron);

        var node = new Node3D { Name = "stpaul_north_door" };
        var oakMesh = wood.Commit(oak); var ironMesh = metal.Commit(iron);
        node.AddChild(new MeshInstance3D { Name = "oak", Mesh = oakMesh, VisibilityRangeEnd = 200, VisibilityRangeEndMargin = 20, VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self });
        node.AddChild(new MeshInstance3D { Name = "iron", Mesh = ironMesh, VisibilityRangeEnd = 90, VisibilityRangeEndMargin = 10, VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self });
        // the leaves are solid: a box over the opening up to its springing, in the leaves' own thickness
        var body = new StaticBody3D { Name = "Solid", CollisionLayer = Scheldemist.World.Solid.Layer, CollisionMask = 0 };
        body.AddChild(new CollisionShape3D { Name = "Shape", Shape = new BoxShape3D { Size = new Vector3(2.8f, 3.37f, 0.08f) }, Position = xf * new Vector3(0, 1.685f, 0.04f) });
        node.AddChild(body);
        holder.AddChild(node);
        return true;
    }

    // ------------------------------------------------------------------ Sint-Jacob's churchyard wall

    // the wall's runs (church_stjacob_6: 0.6 m of blue stone, its flat top at 2.5 m): along x on the south and north sides,
    // along z on the west and east, each (fixed coordinate, from, to); the long sides' copings run past the corners, the short
    // sides' run on into them to their ridge, so the two saddle tops meet in one seam and the short stone's end lies inside
    // the long one (round 1 stopped them 5 mm short: their end bevel stood over the long stone's edge as a bright line)
    private const float WallTop = 2.5f, WallHalf = 0.297f, Over = 0.05f;
    private static readonly (bool AlongX, float At, float From, float To)[] Runs =
    {
        (true, 332.646f, -134.456f - Over, -112.171f + Over), (true, 332.646f, -100.770f - Over, -55.744f + Over),
        (true, 277.355f, -134.456f - Over, -123.470f + Over), (true, 277.355f, -100.770f - Over, -55.744f + Over),
        (false, -134.155f, 277.355f, 332.646f),
        (false, -56.045f, 277.355f, 284.200f + Over), (false, -56.045f, 325.800f - Over, 332.646f),
    };

    private static int JacobWallCoping(Node3D holder)
    {
        var stone = ResourceLoader.Load<Material>(BlueStone);
        if (stone == null) return 0;
        var st = new Builder(Transform3D.Identity);
        var rng = new Random(1491);
        int stones = 0;
        foreach (var run in Runs)
        {
            for (float s = run.From; s < run.To - 0.05f;)
            {
                float len = Math.Min(0.75f + 0.35f * (float)rng.NextDouble(), run.To - s);
                if (run.To - s - len < 0.4f) len = run.To - s;
                float a = s + (s > run.From ? 0.0035f : 0), b = s + len - (s + len < run.To - 0.01f ? 0.0035f : 0);
                Coping(st, run.AlongX, run.At, a, b, rng);
                stones++;
                s += len;
            }
        }
        var node = new Node3D { Name = "stjacob_wall_coping" };
        node.AddChild(new MeshInstance3D { Name = "coping", Mesh = st.Commit(stone), VisibilityRangeEnd = 260, VisibilityRangeEndMargin = 20, VisibilityRangeFadeMode = GeometryInstance3D.VisibilityRangeFadeModeEnum.Self });
        // (solid as the wall under it: a box a run)
        var body = new StaticBody3D { Name = "Solid", CollisionLayer = Scheldemist.World.Solid.Layer, CollisionMask = 0 };
        foreach (var run in Runs)
        {
            float mid = (run.From + run.To) / 2, len = run.To - run.From;
            var c = run.AlongX ? new Vector3(mid, WallTop + 0.06f, run.At) : new Vector3(run.At, WallTop + 0.06f, mid);
            var size = run.AlongX ? new Vector3(len, 0.12f, 2 * (WallHalf + Over)) : new Vector3(2 * (WallHalf + Over), 0.12f, len);
            body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = size }, Position = c });
        }
        node.AddChild(body);
        holder.AddChild(node);
        return stones;
    }

    /// <summary>
    /// One saddle-backed coping stone from a to b along its run: 50 mm over each face of the wall, upright faces 60 mm deep
    /// with a 12 mm worn arris, the weathered top rising 50 mm to a softly rounded ridge; its ends bevelled 8 mm; the top paler
    /// (washed by the rain), the faces the stone's own blue, the underside of the overhang in its shadow. UV in metres / 3 (the
    /// wall's own repeat).
    /// </summary>
    private static void Coping(Builder st, bool alongX, float at, float a, float b, Random rng)
    {
        float h = WallHalf + Over, y0 = WallTop - 0.012f, tone = 0.84f + 0.12f * (float)rng.NextDouble();
        float sag = ((float)rng.NextDouble() - 0.5f) * 0.006f, tilt = ((float)rng.NextDouble() - 0.5f) * 0.004f;
        // the section (d across, y up), from one bed edge round over the top to the other; its normals
        var prof = new List<(Vector2 P, Vector2 N, float K)>
        {
            (new(-h, y0), new(-1, 0), 0.8f), (new(-h, y0 + 0.058f), new(-1, 0), 0.82f),
            (new(-h + 0.0035f, y0 + 0.0665f), new(-0.71f, 0.71f), 0.95f), (new(-h + 0.012f, y0 + 0.07f), new(-0.14f, 0.99f), 1.02f),
            (new(-0.03f, y0 + 0.117f), new(-0.08f, 1f), 1.05f), (new(0, y0 + 0.12f), new(0, 1), 1.06f), (new(0.03f, y0 + 0.117f), new(0.08f, 1f), 1.05f),
            (new(h - 0.012f, y0 + 0.07f), new(0.14f, 0.99f), 1.02f), (new(h - 0.0035f, y0 + 0.0665f), new(0.71f, 0.71f), 0.95f),
            (new(h, y0 + 0.058f), new(1, 0), 0.82f), (new(h, y0), new(1, 0), 0.8f),
        };
        Vector3 W(float s, Vector2 p) { var q = new Vector2(p.X, p.Y + sag * MathF.Sin(MathF.PI * (s - a) / Math.Max(0.1f, b - a)) + tilt * (s - a)); return alongX ? new Vector3(s, q.Y, at + q.X) : new Vector3(at + q.X, q.Y, s); }
        Vector3 N(Vector2 n) { n = n.Normalized(); return alongX ? new Vector3(0, n.Y, n.X) : new Vector3(n.X, n.Y, 0); }
        Vector2 Uv(float s, Vector2 p, Vector2 n) => Math.Abs(n.Y) > 0.6f ? new Vector2(s / 3, (at + p.X) / 3) : new Vector2(s / 3, -p.Y / 3 + p.X);
        Color C(float k) => new(tone * k * 0.97f, tone * k * 0.99f, tone * k);
        const float bev = 0.008f;
        // the long faces, from end bevel to end bevel
        for (int i = 0; i + 1 < prof.Count; i++)
        {
            var (p, np, kp) = prof[i]; var (q, nq, kq) = prof[i + 1];
            st.Quad(W(a + bev, p), W(b - bev, p), W(b - bev, q), W(a + bev, q), N(np), N(np), N(nq), N(nq), Uv(a, p, np), Uv(b, p, np), Uv(b, q, nq), Uv(a, q, nq), C(kp), C(kp), C(kq), C(kq));
        }
        // the underside of each overhang, in shadow
        foreach (int sd in new[] { -1, 1 })
        {
            var o = new Vector2(sd * h, y0); var i = new Vector2(sd * WallHalf, y0);
            st.Quad(W(a, i), W(b, i), W(b, o), W(a, o), Vector3.Down, Vector3.Down, Vector3.Down, Vector3.Down, Uv(a, i, Vector2.Down), Uv(b, i, Vector2.Down), Uv(b, o, Vector2.Down), Uv(a, o, Vector2.Down), C(0.5f), C(0.5f), C(0.5f), C(0.5f));
        }
        // the ends: a bevel round the section, then the end face inset by it
        var c = new Vector2(0, y0 + 0.04f);
        foreach (var (s, e, dir) in new[] { (a + bev, a, -1f), (b - bev, b, 1f) })
        {
            var endN = alongX ? new Vector3(dir, 0, 0) : new Vector3(0, 0, dir);
            for (int i = 0; i + 1 < prof.Count; i++)
            {
                var (p, np, _) = prof[i]; var (q, nq, _) = prof[i + 1];
                Vector2 pi = c + (p - c) * 0.94f, qi = c + (q - c) * 0.94f;
                var n0 = (N(np) + endN).Normalized(); var n1 = (N(nq) + endN).Normalized();
                st.Quad(W(s, p), W(s, q), W(e, qi), W(e, pi), n0, n1, endN, endN, Uv(s, p, Vector2.Right), Uv(s, q, Vector2.Right), Uv(e, qi, Vector2.Right), Uv(e, pi, Vector2.Right), C(0.86f), C(0.86f), C(0.84f), C(0.84f));
            }
            for (int i = 0; i + 1 < prof.Count; i++)
            {
                Vector2 pi = c + (prof[i].P - c) * 0.94f, qi = c + (prof[i + 1].P - c) * 0.94f;
                st.Tri(W(e, c), W(e, pi), W(e, qi), endN, new Vector2(c.X, c.Y) / 3, pi / 3, qi / 3, C(0.84f));
            }
        }
    }

    // ------------------------------------------------------------------ geometry

    /// <summary>Triangles in a frame, each wound so its face looks along the normal it is given (front faces clockwise as seen).</summary>
    private sealed class Builder
    {
        private readonly List<Vector3> pos = new(), nor = new();
        private readonly List<Vector2> uvs = new();
        private readonly List<Color> cols = new();
        private readonly Transform3D xf;
        private int count;
        public Builder(Transform3D xf) { this.xf = xf; }

        private void V(Vector3 p, Vector3 n, Vector2 uv, Color c) { nor.Add((xf.Basis * n).Normalized()); uvs.Add(uv); cols.Add(c); pos.Add(xf * p); }

        public void Tri(Vector3 a, Vector3 b, Vector3 c, Vector3 n, Vector2 ua, Vector2 ub, Vector2 uc, Color col) => Tri(a, b, c, n, n, n, ua, ub, uc, col, col, col);

        public void Tri(Vector3 a, Vector3 b, Vector3 c, Vector3 na, Vector3 nb, Vector3 nc, Vector2 ua, Vector2 ub, Vector2 uc, Color ca, Color cb, Color cc)
        {
            var face = (b - a).Cross(c - a);
            if (face.LengthSquared() < 1e-14f) return;
            // (Godot's front face winds clockwise as seen: a, c, b when the face's own normal looks along n)
            if (face.Dot(na + nb + nc) > 0) { V(a, na, ua, ca); V(c, nc, uc, cc); V(b, nb, ub, cb); }
            else { V(a, na, ua, ca); V(b, nb, ub, cb); V(c, nc, uc, cc); }
            count++;
        }

        public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 na, Vector3 nb, Vector3 nc, Vector3 nd, Vector2 ua, Vector2 ub, Vector2 uc, Vector2 ud, Color ca, Color cb, Color cc, Color cd)
        {
            Tri(a, b, c, na, nb, nc, ua, ub, uc, ca, cb, cc);
            Tri(a, c, d, na, nc, nd, ua, uc, ud, ca, cc, cd);
        }

        /// <summary>
        /// A board or iron flat: a convex outline (x, y; counter-clockwise) from z0 back to z1 front, its front arrises
        /// chamfered by ch (the front inset by ch, a 45-degree band out to the outline, the sides back to z0); no back.
        /// </summary>
        public void Prism(Vector2[] outline, float z0, float z1, float ch, Func<Vector2, Color> col, Vector2 uvOff, float uvScale)
        {
            int n = outline.Length;
            var inset = new Vector2[n];
            for (int i = 0; i < n; i++)
            {
                var p = outline[i]; var prev = outline[(i + n - 1) % n]; var next = outline[(i + 1) % n];
                Vector2 e0 = (p - prev).Normalized(), e1 = (next - p).Normalized();
                // (inward normals of a counter-clockwise outline: the edge turned left)
                Vector2 m0 = new(-e0.Y, e0.X), m1 = new(-e1.Y, e1.X);
                var bis = (m0 + m1); float k = bis.Dot(m1);
                inset[i] = p + (Math.Abs(k) > 1e-4f ? bis * (ch / k) : m1 * ch);
            }
            Vector2 Uv(Vector2 p) => p * uvScale + uvOff;
            var front = Vector3.Back;
            for (int i = 1; i + 1 < n; i++)
                Tri(new Vector3(inset[0].X, inset[0].Y, z1), new Vector3(inset[i].X, inset[i].Y, z1), new Vector3(inset[i + 1].X, inset[i + 1].Y, z1), front, Uv(inset[0]), Uv(inset[i]), Uv(inset[i + 1]), col(inset[0]));
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                var e = outline[j] - outline[i];
                var outN = new Vector3(e.Y, -e.X, 0).Normalized();
                var bevN = (outN + front).Normalized();
                Vector3 pi = new(inset[i].X, inset[i].Y, z1), pj = new(inset[j].X, inset[j].Y, z1), oi = new(outline[i].X, outline[i].Y, z1 - ch), oj = new(outline[j].X, outline[j].Y, z1 - ch);
                Quad(pi, pj, oj, oi, bevN, bevN, bevN, bevN, Uv(inset[i]), Uv(inset[j]), Uv(outline[j]), Uv(outline[i]), col(inset[i]), col(inset[j]), col(outline[j]), col(outline[i]));
                Vector3 bi = new(outline[i].X, outline[i].Y, z0), bj = new(outline[j].X, outline[j].Y, z0);
                float u0 = 0, u1 = e.Length() * uvScale;
                var dim = 0.82f;
                Color ci = col(outline[i]) * dim, cj = col(outline[j]) * dim; ci.A = 1; cj.A = 1;
                Quad(oi, oj, bj, bi, outN, outN, outN, outN, new Vector2(u0, z1 * uvScale) + uvOff, new Vector2(u1, z1 * uvScale) + uvOff, new Vector2(u1, z0 * uvScale) + uvOff, new Vector2(u0, z0 * uvScale) + uvOff, ci, cj, cj, ci);
            }
        }

        /// <summary>A forged nail head or boss: a low square pyramid, its corners turned 45 degrees.</summary>
        public void Stud(Vector3 at, float r, float h, Color c)
        {
            var top = at + new Vector3(0, 0, h);
            var pts = Enumerable.Range(0, 4).Select(i => at + new Vector3(r * MathF.Cos(i * MathF.PI / 2 + 0.3f), r * MathF.Sin(i * MathF.PI / 2 + 0.3f), 0)).ToArray();
            for (int i = 0; i < 4; i++)
            {
                var a = pts[i]; var b = pts[(i + 1) % 4];
                var n = (b - a).Cross(top - a).Normalized();
                if (n.Z < 0) n = -n;
                Tri(a, b, top, n, Vector2.Zero, new Vector2(0.02f, 0), new Vector2(0.01f, 0.02f), c);
            }
        }

        /// <summary>A pintle's knuckle: an upright eight-sided barrel, its ends chamfered.</summary>
        public void Knuckle(Vector3 at, float r, float h, Color c)
        {
            for (int i = 0; i < 8; i++)
            {
                float a0 = i * MathF.Tau / 8, a1 = (i + 1) * MathF.Tau / 8;
                Vector3 d0 = new(MathF.Cos(a0), 0, MathF.Sin(a0)), d1 = new(MathF.Cos(a1), 0, MathF.Sin(a1));
                var n = (d0 + d1).Normalized();
                Vector3 lo0 = at + d0 * r + Vector3.Down * (h / 2 - 0.004f), lo1 = at + d1 * r + Vector3.Down * (h / 2 - 0.004f), hi0 = at + d0 * r + Vector3.Up * (h / 2 - 0.004f), hi1 = at + d1 * r + Vector3.Up * (h / 2 - 0.004f);
                Quad(lo0, lo1, hi1, hi0, d0, d1, d1, d0, new(0, 0), new(0.02f, 0), new(0.02f, h), new(0, h), c, c, c, c);
                foreach (int s in new[] { -1, 1 })
                {
                    var cap = at + Vector3.Up * s * (h / 2);
                    var e0 = at + d0 * (r - 0.004f) + Vector3.Up * s * (h / 2); var e1 = at + d1 * (r - 0.004f) + Vector3.Up * s * (h / 2);
                    var r0 = s > 0 ? hi0 : lo0; var r1 = s > 0 ? hi1 : lo1;
                    var bn = (n + Vector3.Up * s).Normalized();
                    Quad(r0, r1, e1, e0, bn, bn, bn, bn, Vector2.Zero, new(0.02f, 0), new(0.02f, 0.01f), new(0, 0.01f), c, c, c, c);
                    Tri(cap, e0, e1, Vector3.Up * s, Vector2.Zero, new(0.01f, 0), new(0, 0.01f), c);
                }
            }
        }

        /// <summary>A ring of round iron (radius rr, its bar rb) hanging flat against the door: 16 pieces of 6 sides.</summary>
        public void Ring(Vector3 centre, float rr, float rb, Color c)
        {
            const int seg = 16, sides = 6;
            Vector3 P(int i, int j)
            {
                float a = i * MathF.Tau / seg, b = j * MathF.Tau / sides;
                var d = new Vector3(MathF.Cos(a), MathF.Sin(a), 0);
                return centre + d * (rr + rb * MathF.Cos(b)) + new Vector3(0, 0, rb * MathF.Sin(b));
            }
            Vector3 Nn(int i, int j)
            {
                float a = i * MathF.Tau / seg, b = j * MathF.Tau / sides;
                return new Vector3(MathF.Cos(a) * MathF.Cos(b), MathF.Sin(a) * MathF.Cos(b), MathF.Sin(b));
            }
            for (int i = 0; i < seg; i++)
                for (int j = 0; j < sides; j++)
                    Quad(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), Nn(i, j), Nn(i + 1, j), Nn(i + 1, j + 1), Nn(i, j + 1), Vector2.Zero, new(0.02f, 0), new(0.02f, 0.02f), new(0, 0.02f), c, c, c, c);
        }

        /// <summary>The triangles as one surface, built as the shop fronts' merged parts are (their vertex colours kept).</summary>
        public ArrayMesh Commit(Material m)
        {
            var arrays = new Godot.Collections.Array(); arrays.Resize((int)Mesh.ArrayType.Max);
            arrays[(int)Mesh.ArrayType.Vertex] = pos.ToArray(); arrays[(int)Mesh.ArrayType.Normal] = nor.ToArray();
            arrays[(int)Mesh.ArrayType.TexUV] = uvs.ToArray(); arrays[(int)Mesh.ArrayType.Color] = cols.ToArray();
            arrays[(int)Mesh.ArrayType.Index] = Enumerable.Range(0, pos.Count).ToArray();
            var mesh = new ArrayMesh();
            mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
            mesh.SurfaceSetMaterial(0, m);
            return mesh;
        }
    }
}
