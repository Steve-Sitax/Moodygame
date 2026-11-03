using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.Native.World;

public static partial class NativeCathedralTowers
{
    // Authoring only: subtract these volumes from the CURRENT native mesh, never a retired bake.
    // Boundaries lie in solid masonry outside the jamb mouldings. Buttresses/side blind panels stay.
    public static IEnumerable<(OpeningPanel Panel, ArrayMesh Wall, ArrayMesh Dress)> ShellPanels()
    {
        foreach (var op in Openings().Where(o => o.Name.Contains("tower stage") && !o.Name.Contains("stage 3")))
        {
            bool first = op.Name.Contains("stage 1");
            float length = first ? 12 : 11.7f, y0 = first ? 18 : 36, y1 = first ? 35.3f : 54.8f;
            float bottom = op.Hole.Min(p => p.Y);
            // The inner second-stage face meets the existing west roof at 40.15 m.
            if (bottom > y0 + 1) y0 = WestEaves;
            var panel = new OpeningPanel(op.P, op.D, op.O, 1.25f, length-1.25f, y0, y1+.6f);
            var wall = new Builder(); var dress = new Builder();
            var hole = op.Hole;
            // Horizontal bands triangulate the actual annulus: there is no wall across the opening.
            var levels = new SortedSet<float>(hole.Select(p => p.Y)) { y0, y1+.6f };
            var ys = levels.ToArray();
            void Face(Vector2[] poly, float e, Vector3 normal)
            {
                for (int i=1;i+1<poly.Length;i++) wall.Tri(Pt(op,poly[0],e),Pt(op,poly[i],e),Pt(op,poly[i+1],e),normal,
                    poly[0]*AshlarUv,poly[i]*AshlarUv,poly[i+1]*AshlarUv,Colors.White);
            }
            for(int j=0;j+1<ys.Length;j++)
            {
                float lo=ys[j], hi=ys[j+1];
                var mid=Span(hole,false,(lo+hi)/2);
                var a=Span(hole,false,lo+.00001f); var b=Span(hole,false,hi-.00001f);
                var pieces=new List<Vector2[]>();
                if(mid == null) pieces.Add(new[]{new Vector2(panel.Left,lo),new Vector2(panel.Right,lo),new Vector2(panel.Right,hi),new Vector2(panel.Left,hi)});
                else
                {
                    var al=a ?? mid; var bl=b ?? mid;
                    pieces.Add(new[]{new Vector2(panel.Left,lo),new Vector2(al.Value.Item1,lo),new Vector2(bl.Value.Item1,hi),new Vector2(panel.Left,hi)});
                    pieces.Add(new[]{new Vector2(al.Value.Item2,lo),new Vector2(panel.Right,lo),new Vector2(panel.Right,hi),new Vector2(bl.Value.Item2,hi)});
                }
                foreach(var poly in pieces) { Face(poly,0,op.O); Face(poly,-1,-op.O); }
            }
            // Continuous metre-deep reveal; the front arris is concealed within the rounded archivolt.
            for(int i=0;i<hole.Length;i++)
            {
                var a=hole[i];var b=hole[(i+1)%hole.Length];
                var t=(b-a).Normalized(); var n=PlaneDir(op,new Vector2(-t.Y,t.X));
                wall.Quad(Pt(op,a,0),Pt(op,b,0),Pt(op,b,-1),Pt(op,a,-1),n,
                    Vector2.Zero,new Vector2(a.DistanceTo(b)*AshlarUv,0),new Vector2(a.DistanceTo(b)*AshlarUv,AshlarUv),new Vector2(0,AshlarUv),Colors.White);
            }
            var arch=hole.Skip(1).Concat(new[]{hole[0]}).ToArray();
            StoneSweep(dress,op,arch,.32f,.10f,.23f);
            // Nested moulding, sunk into the reveal, plus weathered sill and a single hood.
            StoneSweep(dress,op,arch,.18f,-.20f,.12f);
            StoneSweep(dress,op,new[]{hole[0],hole[1]},.24f,.12f,.30f);
            float left=hole.Min(p=>p.X),right=hole.Max(p=>p.X),top=hole.Max(p=>p.Y);
            StoneSweep(dress,op,new[]{new Vector2(left-.1f,op.Springing),new Vector2(length/2,y1-.35f),new Vector2(right+.1f,op.Springing)},.24f,.40f,.16f);
            // Reinstate the continuous string course cut with the obsolete paired finials.
            StoneSweep(dress,op,new[]{new Vector2(panel.Left,y1-.5f),new Vector2(panel.Right,y1-.5f)},.25f,.14f,.20f);
            yield return (panel,wall.Commit(ResourceLoader.Load<Material>(Ashlar)),dress.Commit(ResourceLoader.Load<Material>(Carved)));
        }
    }

    public sealed record OpeningPanel(Vector3 P,Vector3 D,Vector3 O,float Left,float Right,float Bottom,float Top)
    {
        public (Vector3 N,float Offset)[] Planes => new[] {
            (D,P.Dot(D)+Left),(-D,-P.Dot(D)-Right),(Vector3.Up,Bottom),(Vector3.Down,-Top),
            (O,P.Dot(O)-1.02f),(-O,-P.Dot(O)-1.4f) };
    }
}
