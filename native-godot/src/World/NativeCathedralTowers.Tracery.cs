using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.Native.World;

public static partial class NativeCathedralTowers
{
    // Stone tracery follows the final native shell and stands ahead of iron and oak.
    private static void Tracery(Opening op, Builder stone)
    {
        float left = op.Hole.Min(p => p.X), right = op.Hole.Max(p => p.X);
        float bottom = op.Hole.Min(p => p.Y), top = op.Hole.Max(p => p.Y);
        float centre = (left + right) / 2, width = right - left;
        float spring = op.Springing;
        if (spring - bottom < .5f || width < .5f) return;
        // A broad chamfer with a rounded arris: 8 mm radius, in metres, on all
        // exposed section corners. Sweeps also close their ends at masonry joints.
        void Member(IReadOnlyList<Vector2> path, float breadth = .24f)
            => StoneSweep(stone, op, path, breadth, -op.Depth * .45f + .03f, .16f);
        int lights = width > 6 ? 4 : 2;
        for (int i=1;i<lights;i++)
            Member(new[] { new Vector2(left+width*i/lights, bottom-.02f), new Vector2(left+width*i/lights, spring) });
        // The old two transoms are enclosed by the moulded stone section.
        foreach (float fraction in op.Depth > .9f ? new[] { .4f, .66f } : Array.Empty<float>())
        {
            // Roof-clipped inner faces retain the original stage's transom heights.
            float springFraction = op.Depth > .9f ? .8f : .76f;
            float fullHeight = (top - spring) / (1 - springFraction);
            float y = top - fraction * fullHeight;
            if (y > bottom + .1f && Span(op.Hole, false, y) is (float lo, float hi))
                Member(new[] { new Vector2(lo - .02f, y), new Vector2(hi + .02f, y) });
        }
        // Four sub-lights in each broad lower lancet, two in each retained narrow opening.
        // Their arch rise is kept below the enclosing shell even on the short octagon heads.
        float rise = Math.Min((top - spring) * .43f, width / lights * .48f);
        for (int light = 0; light < lights; light++)
        {
            float a = left + light * width / lights, b = a + width / lights;
            var path = new List<Vector2>();
            const int steps = 24;
            for (int i = 0; i <= steps; i++)
            {
                float x = i / (float)steps, q = Math.Min(x, 1 - x);
                float y = spring + rise * MathF.Sqrt(Math.Max(0, 1.5625f - (q - 1.25f) * (q - 1.25f)));
                path.Add(new Vector2(Mathf.Lerp(a, b, x), y));
            }
            Member(path, .18f);
        }
        float radius = Math.Min(width * .135f, (top - spring) * .20f);
        float cy = spring + rise + radius * .88f;
        var foil = new List<Vector2>();
        for (int i = 0; i <= 48; i++)
        {
            float theta = Mathf.Tau * i / 48;
            float r = radius * (1 + .20f * MathF.Cos(theta * 4));
            foil.Add(new Vector2(centre + r * MathF.Cos(theta), cy + r * MathF.Sin(theta)));
        }
        // Reject an ill-fitting head instead of running stone through the reveal.
        if (foil.All(p => Span(op.Hole, false, p.Y) is (float lo, float hi) && p.X > lo + .1f && p.X < hi - .1f))
        {
            Member(foil, .14f);
            Member(new[] { new Vector2(centre, spring), new Vector2(centre, cy-radius*1.2f) }, .18f);
            // Land on the outer sub-light apex: quarter-width only fits two lights.
            foreach (float side in new[] { -1f, 1f })
                Member(new[] { new Vector2(centre + side*width*(lights-1)/(2*lights), spring+rise),
                    new Vector2(centre + side*radius*1.2f, cy) }, .14f);
        }
    }

    private static void StoneSweep(Builder mesh, Opening op, IReadOnlyList<Vector2> path, float width, float depth, float halfDepth)
    {
        // Rounded octagonal moulding, sampled around every arris. A shared ring at
        // bends avoids the open mitres produced by separate straight bars.
        var corners = new[] {
            new Vector2(-width/2 + .035f, -halfDepth), new Vector2(width/2 - .035f, -halfDepth),
            new Vector2(width/2, -halfDepth + .035f), new Vector2(width/2, halfDepth - .035f),
            new Vector2(width/2 - .035f, halfDepth), new Vector2(-width/2 + .035f, halfDepth),
            new Vector2(-width/2, halfDepth - .035f), new Vector2(-width/2, -halfDepth + .035f)
        };
        var section = new List<Vector2>();
        for (int j = 0; j < corners.Length; j++)
        {
            var c = corners[j];
            var incoming = (corners[(j + 7) % 8] - c).Normalized();
            var outgoing = (corners[(j + 1) % 8] - c).Normalized();
            float halfAngle = MathF.Acos(incoming.Dot(outgoing)) / 2;
            const float radius = .008f;
            var arcCentre = c + (incoming + outgoing).Normalized() * (radius / MathF.Sin(halfAngle));
            var a = c + incoming * (radius / MathF.Tan(halfAngle));
            var b = c + outgoing * (radius / MathF.Tan(halfAngle));
            float start = (a - arcCentre).Angle(), turn = (a - arcCentre).AngleTo(b - arcCentre);
            for (int k = 0; k <= 2; k++)
            {
                float angle = start + turn * k / 2;
                section.Add(arcCentre + new Vector2(MathF.Cos(angle), MathF.Sin(angle)) * radius);
            }
        }
        bool closed = path[0].DistanceTo(path[^1]) < .001f;
        var rings = new Vector3[path.Count][];
        var distances = new float[path.Count][];
        for (int i = 0; i < path.Count; i++)
        {
            var prev = path[i == 0 ? (closed ? path.Count-2 : 0) : i-1];
            var next = path[i == path.Count-1 ? (closed ? 1 : i) : i+1];
            var tangent = (next - prev).Normalized();
            var across = op.D * -tangent.Y + Vector3.Up * tangent.X;
            var origin = op.P + op.D * path[i].X + Vector3.Up * path[i].Y + op.O * depth;
            rings[i] = section.Select(s => origin + across * s.X + op.O * s.Y).ToArray();
            distances[i] = new float[section.Count];
            if (i > 0)
                for (int j = 0; j < section.Count; j++)
                    distances[i][j] = distances[i-1][j] + rings[i][j].DistanceTo(rings[i-1][j]);
        }
        for (int i = 0; i < path.Count-1; i++)
        {
            float perimeter = 0;
            for (int j = 0; j < section.Count; j++)
            {
                int k = (j+1) % section.Count;
                float end = perimeter + section[j].DistanceTo(section[k]);
                var a = rings[i][j]; var b = rings[i][k]; var c = rings[i+1][k]; var d = rings[i+1][j];
                var n = (b-a).Cross(d-a).Normalized();
                var axis = op.P + op.D * ((path[i].X+path[i+1].X)/2) + Vector3.Up * ((path[i].Y+path[i+1].Y)/2) + op.O * depth;
                if (n.Dot((a+b+c+d)/4-axis) < 0) n = -n;
                mesh.Quad(a,b,c,d,n,new Vector2(perimeter,distances[i][j])*CarvedUv,new Vector2(end,distances[i][k])*CarvedUv,
                    new Vector2(end,distances[i+1][k])*CarvedUv,new Vector2(perimeter,distances[i+1][j])*CarvedUv,Colors.White);
                perimeter = end;
            }
        }
        if (!closed)
            foreach (int i in new[] { 0, path.Count-1 })
            {
                var tangent = i == 0 ? path[0]-path[1] : path[^1]-path[^2];
                var normal = (op.D*tangent.X + Vector3.Up*tangent.Y).Normalized();
                var centre = rings[i].Aggregate(Vector3.Zero, (sum, p) => sum+p) / section.Count;
                for (int j = 0; j < section.Count; j++)
                {
                    int k = (j+1) % section.Count;
                    mesh.Tri(centre, rings[i][j], rings[i][k], normal, Vector2.Zero,
                        section[j]*CarvedUv, section[k]*CarvedUv, Colors.White);
                }
            }
    }
}
