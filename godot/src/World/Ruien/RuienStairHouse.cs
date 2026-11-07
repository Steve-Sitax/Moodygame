using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

/// <summary>
/// The small stair-house over an entrance's stair on a square, a green or a quay (docs/ruien-native.md, "Entrances",
/// host `stair_house`): a city-works access house of 1873, brick on a bluestone plinth, with parapet gables under
/// bluestone coping, a slate roof with a zinc ridge, iron gutters and downpipes, wall anchors, and the kit's own
/// bluestone door surround, oak door and wrought-iron fanlight in the front gable. It wraps the kit's lined and vaulted
/// stair (RuienEntrance.Kit) down to the point where the flight's vault is under the paving; the rest of the stair runs on
/// under the street. One model: the shell is one mesh and one collision shape shared by every stair-house, in the town's
/// own materials (no new shader kind; they take the sky and the sun like any town wall, and cast a shadow).
///
/// Frame: the entrance's `Local` (origin the middle of the doorway on the front face at street level, X right as seen from
/// the street, Z out to the street). The house stands from Z 0 back to -Length.
/// </summary>
public static partial class RuienStairHouse
{
    // (the town's materials: environment-20261013's wall brick, stair stone, slate and iron; native-godot/assets/materials)
    private const string BrickMaterial = "res://world/town/resources/r000630.res";
    private const string StoneMaterial = "res://world/town/resources/r000648.res";
    private const string SlateMaterial = "res://world/town/resources/r000087.res";
    private const string IronMaterial = "res://world/town/resources/r000615.res";
    // The pictures' tiles in metres (README of environment-20261013: brick 1.84 x 1.56 m cross-bond courses; the stone's
    // grain 1.2 m; slate 8 courses of about 20 cm).
    private static readonly Vector2 BrickTile = new(1.84f, 1.56f), StoneTile = new(1.2f, 1.2f), SlateTile = new(1.6f, 1.6f), IronTile = new(.6f, .6f);

    /// <summary>Half the house's width over its brick (the kit's lining is 0.65 + 0.28; the outer skin a half brick more).</summary>
    public const float Half = 1.04f;
    /// <summary>The plinth's projection beyond the brick, its top over the street, its foot under it.</summary>
    public const float PlinthOut = .03f, PlinthTop = .45f, PlinthFoot = -.4f;
    /// <summary>The wall plate (eaves) over the street, the roof's pitch (degrees), the parapet over the slates.</summary>
    public const float Eaves = 2.9f, PitchDeg = 45, Parapet = .12f;
    /// <summary>The back gable's thickness (the front's is the entry's `wall`).</summary>
    public const float BackWall = .34f;
    /// <summary>Paving and bed over the flight's vault where it leaves the house (metres over the vault's back).</summary>
    public const float Cover = .2f;
    /// <summary>The skin's depth over the lining at the front (the surround stands in it).</summary>
    private const float Skin = .06f;

    /// <summary>The house's length from its front face back to its back face.</summary>
    public static float Length(RuienEntrance.Spec s) => s.Wall + s.HouseBack + BackWall;
    /// <summary>The ridge over the street (the slates' top).</summary>
    public static float Ridge => Eaves + .1f + Half * MathF.Tan(Mathf.DegToRad(PitchDeg));

    /// <summary>The plinth's outline (local), the box the town's ground and plants give way in.</summary>
    public static (Vector3 lo, Vector3 hi) Outline(RuienEntrance.Spec s)
        => (new Vector3(-Half - PlinthOut, PlinthFoot - .3f, -Length(s) - PlinthOut), new Vector3(Half + PlinthOut, Ridge + .4f, PlinthOut));

    private sealed record Made(ArrayMesh Mesh, ConcavePolygonShape3D Shape);
    private static readonly Dictionary<string, Made> made = new();

    /// <summary>The house over an entrance: the shared shell (mesh and collision) under a node at the entrance's frame.</summary>
    public static Node3D Build(RuienEntrance.Spec s)
    {
        string key = FormattableString.Invariant($"{s.Wall:0.000}/{s.HouseBack:0.000}/{s.DoorOpening.H:0.000}/{s.DoorOpening.Spring:0.000}/{s.DoorOpening.Rise:0.000}/{s.Width:0.000}/{s.Lining:0.000}");
        if (!made.TryGetValue(key, out var m)) made[key] = m = Make(s);
        var root = new Node3D { Name = "stair_house" };
        root.AddChild(new MeshInstance3D { Name = "shell", Mesh = m.Mesh, VisibilityRangeEnd = 260, VisibilityRangeEndMargin = 10 });
        var body = new StaticBody3D { Name = "shell_solid", CollisionLayer = Solid.Layer, CollisionMask = 0 };
        body.AddChild(new CollisionShape3D { Shape = m.Shape });
        root.AddChild(body);
        root.AddChild(new RuienStairRunoff{Spec=s,Back=-Length(s)});
        return root;
    }

    /// <summary>Surface tools per material, each with its own chart (box-mapped in the house's frame, metres over the tile).</summary>
    private sealed class Parts
    {
        public readonly SurfaceTool Brick = Begin(), Stone = Begin(), Slate = Begin(), Iron = Begin(), Wood = Begin(), Relief = Begin();
        private static SurfaceTool Begin() { var t = new SurfaceTool(); t.Begin(Mesh.PrimitiveType.Triangles); return t; }
    }

    private static Made Make(RuienEntrance.Spec s)
    {
        var p = new Parts();
        var brick = (ShaderMaterial)ResourceLoader.Load<Material>(BrickMaterial).Duplicate();
        brick.SetShaderParameter("relief_depth",0f);
        brick.SetShaderParameter("foot",1f);brick.SetShaderParameter("foot_wear",1f);
        var stone = (ShaderMaterial)ResourceLoader.Load<Material>(StoneMaterial).Duplicate();
        stone.SetShaderParameter("foot",.6f);stone.SetShaderParameter("foot_wear",1f);
        var slate = ResourceLoader.Load<Material>(SlateMaterial);
        var iron = ResourceLoader.Load<Material>(IronMaterial);
        float len = Length(s), back = -len, inner = s.Width / 2 + s.Lining, tan = MathF.Tan(Mathf.DegToRad(PitchDeg));
        void Box(SurfaceTool t, Material mat, Vector3 lo, Vector3 hi, float bevel, Basis? turn = null, Vector3? pivot = null)
        {
            var size = (hi - lo).Abs();
            if (size.X < .002f || size.Y < .002f || size.Z < .002f) return;
            var at = new Transform3D(Basis.Identity, (lo + hi) / 2);
            if (turn is Basis b) { var pv = pivot ?? Vector3.Zero; at = new Transform3D(b, pv) * new Transform3D(Basis.Identity, (lo + hi) / 2 - pv); }
            t.AppendFrom(BevelMesh.Box(size, bevel, mat), 0, at);
        }
        var wood=ResourceLoader.Load<Material>("res://assets/materials/town-facades-20261018/shutter-paint-worn.tres");
        var o = s.DoorOpening;

        // ---- the brick: side walls (full length, their ends in the gables' faces), the front skin round the doorway,
        //      the back wall, the gables over the eaves, a projecting band under the eaves all round
        foreach (float sd in new[] { -1f, 1f })
            Box(p.Brick, brick, new Vector3(sd < 0 ? -Half : inner, 0, back), new Vector3(sd < 0 ? -inner : Half, Eaves + .05f, 0), .006f);
        // the front skin: beside the doorway, over its arch (trimmed to the arch below)
        foreach (float sd in new[] { -1f, 1f })
            Box(p.Brick, brick, new Vector3(sd < 0 ? -inner : o.H, 0, -Skin), new Vector3(sd < 0 ? -o.H : inner, Eaves, 0), .005f);
        // (over the arch's crown: the kit's rowlock ring stands proud over the spandrels below it)
        Box(p.Brick, brick, new Vector3(-o.H, o.Top, -Skin), new Vector3(o.H, Eaves, 0), .005f);
        // the back wall, standing on the flight's vault
        Box(p.Brick, brick, new Vector3(-inner, -.15f, back), new Vector3(inner, Eaves, back + BackWall), .006f);
        // the gables: from the wall plate to the parapet's coping bed (a prism)
        float gableSide = Eaves + .1f + Parapet - .02f, apex = Ridge + Parapet - .02f;
        Gable(p.Brick, -s.Wall, 0, gableSide, apex);
        Gable(p.Brick, back, back + BackWall, gableSide, apex);
        // the band: two courses proud by 4 cm under the eaves, round all four faces
        float b0 = Eaves - .2f, b1 = Eaves - .07f;
        foreach (float sd in new[] { -1f, 1f })
            Box(p.Brick, brick, new Vector3(sd < 0 ? -Half - .04f : Half - .01f, b0, back - .04f), new Vector3(sd < 0 ? -Half + .01f : Half + .04f, b1, .04f), .006f);
        Box(p.Brick, brick, new Vector3(-Half + .01f, b0, -.01f), new Vector3(Half - .01f, b1, .04f), .006f);
        Box(p.Brick, brick, new Vector3(-Half + .01f, b0, back - .04f), new Vector3(Half - .01f, b1, back + .01f), .006f);

        // ---- the bluestone: the plinth in stones with real joints (a weathered top arris), kneelers, coping, splash stones
        float pf = PlinthFoot, pt = PlinthTop, po = Half + PlinthOut;
        void Run(float a0, float a1, Func<float, float, (Vector3, Vector3)> piece, float stoneLen = 1.05f)
        {
            int n = Math.Max(1, (int)MathF.Round((a1 - a0) / stoneLen)); float step = (a1 - a0) / n;
            for (int i = 0; i < n; i++) { var (lo, hi) = piece(a0 + i * step + .002f, a0 + (i + 1) * step - .002f); Box(p.Stone, stone, lo, hi, .012f); }
        }
        foreach (float sd in new[] { -1f, 1f })
        {
            // the sides: their front stone takes the corner, the back stone the back corner
            Run(back - PlinthOut, PlinthOut, (a, b) => (new Vector3(sd < 0 ? -po : inner, pf, a), new Vector3(sd < 0 ? -inner : po, pt, b)));
            // the front beside the door's jambs (the kit's jambs run down to the sill: the plinth stops at them)
            float j = o.H + .26f;
            Box(p.Stone, stone, new Vector3(sd < 0 ? -inner + .002f : j, pf, -s.Wall), new Vector3(sd < 0 ? -j : inner - .002f, pt, PlinthOut), .012f);
        }
        Run(-inner + .002f, inner - .002f, (a, b) => (new Vector3(a, pf, back - PlinthOut), new Vector3(b, pt, back + BackWall)), 1.0f);
        // the coping on the gables' rakes: two slabs a rake, 4 cm over each face; kneelers at the eaves; a block at the apex
        foreach (var (z0, z1) in new[] { (-s.Wall, 0f), (back, back + BackWall) })
        {
            float zm = (z0 + z1) / 2, zw = (z1 - z0) / 2 + .04f;
            foreach (float sd in new[] { -1f, 1f })
            {
                // kneeler: a block over the wall's end, its top where the rake's coping starts
                Box(p.Stone, stone, new Vector3(sd < 0 ? -Half - .04f : Half - .3f, Eaves - .07f, zm - zw), new Vector3(sd < 0 ? -Half + .3f : Half + .04f, gableSide + .3f * tan - .04f, zm + zw), .012f);
                // the rake: from over the kneeler to the apex block, in two slabs on the gable's raking bed
                var a = new Vector3(sd * (Half - .3f), gableSide + .3f * tan, 0); var c = new Vector3(sd * .14f, apex - .14f * tan, 0);
                for (int k = 0; k < 2; k++)
                {
                    var p0 = a.Lerp(c, k / 2f); var p1 = a.Lerp(c, (k + 1) / 2f); var d = p1 - p0; float l = d.Length() - .004f;
                    var up = new Vector3(-d.Y, d.X, 0).Normalized(); if (up.Y < 0) up = -up;
                    var mid = (p0 + p1) / 2 + up * .05f + new Vector3(0, 0, zm);
                    var turn = new Basis(Vector3.Back, MathF.Atan2(d.Y, d.X));
                    var at = new Transform3D(turn, mid);
                    p.Stone.AppendFrom(BevelMesh.Box(new Vector3(l, .1f, 2 * zw), .012f, stone), 0, at);
                }
            }
            Box(p.Stone, stone, new Vector3(-.13f, apex - .16f, zm - zw), new Vector3(.13f, apex + .1f, zm + zw), .012f);
        }

        BrickRelief(p,s,back);

        // Individually lapped slates over timber boarding, fitted between the parapets.
        foreach (float sd in new[] { -1f, 1f })
            Roof(p.Slate, p.Wood, slate, wood, sd, back + BackWall + .002f, -s.Wall - .002f, tan);

        // ---- the iron (painted zinc): the ridge roll and its flanges, gutters on brackets, downpipes with shoes, wall anchors
        float rz0 = back + BackWall, rz1 = -s.Wall;
        Cyl(p.Iron, new Vector3(0, Ridge + .065f, rz0), new Vector3(0, Ridge + .065f, rz1), .032f, 12);
        // Lead soakers return up the parapets under their coping; the exposed sheet lip has a 1 mm radius.
        foreach(float sd in new[]{-1f,1f})
            foreach(float zz in new[]{rz0+.03f,rz1-.03f})
            {
                var down=new Vector3(sd,-tan,0).Normalized();var up=new Vector3(sd*tan,1,0).Normalized();
                var basis=new Basis(down,up,sd>0?Vector3.Back:Vector3.Forward);
                float slope=(Half+.16f)/MathF.Cos(Mathf.DegToRad(PitchDeg));
                p.Iron.AppendFrom(BevelMesh.Box(new Vector3(slope,.004f,.12f),.001f,iron),0,
                    new Transform3D(basis,new Vector3(0,Ridge,zz)+down*(slope/2)+up*.048f));
            }
        foreach (float sd in new[] { -1f, 1f })
        {
            var turn = new Basis(Vector3.Back, -sd * Mathf.DegToRad(PitchDeg));
            var at = new Transform3D(turn, new Vector3(sd * .07f, Ridge - .07f * tan + .052f, (rz0 + rz1) / 2));
            p.Iron.AppendFrom(BevelMesh.Box(new Vector3(.18f, .006f, rz1 - rz0), .002f, iron), 0, at);
            // the gutter: a half-round on the eaves' line, its back on the fascia
            float gx = sd * (Half + .2f), gy = Eaves - .12f;
            Gutter(p.Iron, gx, gy, sd, back + .02f, -.02f);
            for (float z = back + .3f; z < -.2f; z += .9f)
                Box(p.Iron, iron, new Vector3(sd < 0 ? -Half - .26f : Half + .04f, gy + MathF.Abs(z-(back+.35f))*.002f - .085f, z - .015f), new Vector3(sd < 0 ? -Half - .04f : Half + .26f, gy + MathF.Abs(z-(back+.35f))*.002f - .07f, z + .015f), .002f);
            // the downpipe at the back corner, from the gutter's outlet down to its shoe over a splash stone
            float px = sd * (Half + .1f), pz = back + .35f;
            Tube(p.Iron, new Vector3(gx, gy - .055f, pz), new Vector3(px, gy - .32f, pz), .04f);
            Tube(p.Iron, new Vector3(px, gy - .32f, pz), new Vector3(px, .32f, pz), .04f);
            Tube(p.Iron, new Vector3(px, .32f, pz), new Vector3(px + sd * .14f, .1f, pz), .045f);
            foreach (float y in new[] { .8f, 1.9f })
                Box(p.Iron, iron, new Vector3(sd < 0 ? -Half - .15f : Half - .005f, y - .02f, pz - .055f), new Vector3(sd < 0 ? -Half + .005f : Half + .15f, y + .02f, pz + .055f), .002f);
            Drain(p,stone,iron,sd,pz);
            // tie anchors: the roof's tie beams held to the side walls (an iron plate and its wedge)
            foreach (float z in new[] { -s.Wall - 1.4f, back + BackWall + 1.4f })
            {
                Box(p.Iron, iron, new Vector3(sd < 0 ? -Half - .018f : Half, Eaves - .52f, z - .03f), new Vector3(sd < 0 ? -Half : Half + .018f, Eaves - .26f, z + .03f), .003f);
                Box(p.Iron, iron, new Vector3(sd < 0 ? -Half - .03f : Half + .01f, Eaves - .4f, z - .09f), new Vector3(sd < 0 ? -Half - .01f : Half + .03f, Eaves - .37f, z + .09f), .003f);
            }
        }

        var mesh = new ArrayMesh();
        void Commit(SurfaceTool t, Material mat, Vector2 tile, string name, bool chart)
        {
            t.Deindex(); var m = t.Commit(); if (m.GetSurfaceCount() == 0) return;
            var a = m.SurfaceGetArrays(0);
            if (chart) a[(int)Mesh.ArrayType.TexUV] = Chart(a, tile);
            var vertices=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            a[(int)Mesh.ArrayType.Color]=vertices.Select(v=>Weather(v,back,name)).ToArray();
            // Slates and boarding retain the metric charts assigned in their own construction frame.
            mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, a);
            mesh.SurfaceSetMaterial(mesh.GetSurfaceCount() - 1, mat);
            mesh.SurfaceSetName(mesh.GetSurfaceCount() - 1, name);
        }
        Commit(p.Brick, brick, BrickTile, "house_brick", true);
        Commit(p.Relief, brick, BrickTile, "house_brick_relief", false);
        Commit(p.Stone, stone, StoneTile, "house_bluestone", true);
        Commit(p.Slate, slate, SlateTile, "house_slate", false);
        Commit(p.Wood, wood, new Vector2(.6f,.6f), "house_boarding", true);
        Commit(p.Iron, iron, IronTile, "house_iron", true);
        mesh.ResourceName = "ruien_stair_house";
        // Collision: the walls, plinth, stone and roof as drawn (the thin iron too: it is up out of reach or hard by a wall).
        var shape = new ConcavePolygonShape3D { Data = mesh.GetFaces(), BackfaceCollision = true };
        return new Made(mesh, shape);
    }

    /// <summary>A gable's brick between z0 and z1: the wall plate (Eaves) up to `side` at the faces and `apex` in the middle.</summary>
    private static void Gable(SurfaceTool t, float z0, float z1, float side, float apex)
    {
        var outline = new[] { new Vector2(-Half, Eaves), new Vector2(Half, Eaves), new Vector2(Half, side), new Vector2(0, apex), new Vector2(-Half, side) };
        Prism(t, outline, z0, z1);
    }

    /// <summary>A convex outline in x/y extruded from z0 to z1: its two faces and its sides (flat; a sharp arris is hidden under coping or in the corner).</summary>
    private static void Prism(SurfaceTool t, Vector2[] outline, float z0, float z1)
    {
        void Tri(Vector3 a, Vector3 b, Vector3 c)
        {
            var n = (b - a).Cross(c - a).Normalized();
            foreach (var v in new[] { a, c, b }) { t.SetNormal(n); t.SetUV(Vector2.Zero); t.AddVertex(v); }
        }
        int k = outline.Length;
        for (int i = 1; i + 1 < k; i++)
        {
            // front (+z) counter-clockwise seen from +z, back the other way
            Tri(new Vector3(outline[0].X, outline[0].Y, z1), new Vector3(outline[i].X, outline[i].Y, z1), new Vector3(outline[i + 1].X, outline[i + 1].Y, z1));
            Tri(new Vector3(outline[0].X, outline[0].Y, z0), new Vector3(outline[i + 1].X, outline[i + 1].Y, z0), new Vector3(outline[i].X, outline[i].Y, z0));
        }
        for (int i = 0; i < k; i++)
        {
            var a = outline[i]; var b = outline[(i + 1) % k];
            Tri(new Vector3(a.X, a.Y, z0), new Vector3(b.X, b.Y, z0), new Vector3(b.X, b.Y, z1));
            Tri(new Vector3(a.X, a.Y, z0), new Vector3(b.X, b.Y, z1), new Vector3(a.X, a.Y, z1));
        }
    }

    /// <summary>A half-round gutter (outside x of `gx` on side sd) along z, its rolled lip outside, its stop ends.</summary>
    private static void Gutter(SurfaceTool t, float gx, float gy, float sd, float z0, float z1)
    {
        const int n = 10; float r = .065f, wall = .004f;
        Vector3 C(int i, float rr, float z) { float a = MathF.PI * i / n; return new Vector3(gx + sd * MathF.Cos(a) * rr * -1, gy + MathF.Abs(z-(z0+.33f))*.002f - MathF.Sin(a) * rr, z); }
        void Tri(Vector3 a, Vector3 b, Vector3 c, Vector2 ua, Vector2 ub, Vector2 uc)
        {
            var nn = (b - a).Cross(c - a).Normalized()*sd;
            if(sd>0){(b,c)=(c,b);(ub,uc)=(uc,ub);}
            foreach (var (v, uv) in new[] { (a, ua), (b, ub), (c, uc) }) { t.SetNormal(nn); t.SetUV(uv); t.AddVertex(v); }
        }
        float outlet=z0+.33f;
        var spans=new[]{(z0,outlet-.045f,false),(outlet-.045f,outlet+.045f,true),(outlet+.045f,z1,false)};
        foreach(var (a,b,hole) in spans)
            for(int i=0;i<n;i++)
                foreach(float rr in new[]{r,r-wall})
                {
                    if(hole && i>=3 && i<=6)continue;
                    var a0=C(i,rr,a);var a1=C(i+1,rr,a);var b0=C(i,rr,b);var b1=C(i+1,rr,b);
                    if(rr==r){Tri(a0,a1,b1,Vector2.Zero,new(.03f,0),new(.03f,b-a));Tri(a0,b1,b0,Vector2.Zero,new(.03f,b-a),new(0,b-a));}
                    else {Tri(a0,b1,a1,Vector2.Zero,new(.03f,b-a),new(.03f,0));Tri(a0,b0,b1,Vector2.Zero,new(0,b-a),new(.03f,b-a));}
                }
        // the rolled lip (outside) and the stop ends
        foreach(var (a,b,_) in spans)
            Cyl(t,C(n,r,a)+Vector3.Up*.008f,C(n,r,b)+Vector3.Up*.008f,.009f,8);
        foreach(float z in new[]{z0,z1})
        {
            var end=Enumerable.Range(0,n+1).Select(i=>{var q=C(i,r,z);return new Vector2(q.X,q.Y);}).ToArray();
            if(sd<0)Array.Reverse(end);
            Prism(t,end,z-.002f,z+.002f); // 4 mm sheet stop; its thin lip is an intentional sharp sheet edge.
        }
    }

    /// <summary>Rolled ridge and gutter lips, their ends housed against the parapets/stop plates.</summary>
    private static void Cyl(SurfaceTool t,Vector3 a,Vector3 b,float r,int sides)=>Tube(t,a,b,r);

    /// <summary>
    /// Charted flat on each triangle's own plane, in metres over the tile: walls with u along the face and v down it,
    /// tops and bottoms by x and z. A face's courses continue over every piece in its plane; a bevel strip, a gutter's
    /// curve or a coping's slope takes its own true size, never a squeezed projection of a neighbour's.
    /// </summary>
    private static Vector2[] Chart(Godot.Collections.Array a, Vector2 tile)
    {
        var p = a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var uv = new Vector2[p.Length];
        for (int i = 0; i + 2 < p.Length; i += 3)
        {
            var n = (p[i + 1] - p[i]).Cross(p[i + 2] - p[i]);
            if (n.LengthSquared() < 1e-14f) continue;
            n = n.Normalized();
            Vector3 u, v;
            if (MathF.Abs(n.Y) > .9f) { u = Vector3.Right; v = Vector3.Back; }
            else { u = n.Cross(Vector3.Up).Normalized(); v = n.Cross(u); }
            for (int k = 0; k < 3; k++) uv[i + k] = new Vector2(p[i + k].Dot(u), p[i + k].Dot(v)) / tile;
        }
        return uv;
    }

    /// <summary>The tile (metres) of a shell surface by its name, for the UV audit (RuienUv.Audit); null for others.</summary>
    public static Vector2? Tile(string surface) => surface switch
    {
        "house_boarding" => new Vector2(.6f,.6f), "house_brick" => BrickTile, "house_brick_relief" => BrickTile, "house_bluestone" => StoneTile, "house_slate" => SlateTile, "house_iron" => IronTile, _ => null,
    };
}
