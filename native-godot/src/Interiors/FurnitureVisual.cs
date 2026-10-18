using System;
using System.Linq;
using System.Text.Json;
using Godot;
namespace Scheldemist.Native.Interiors;

/// <summary>Optional native kit scene changes appearance while authored identity, collision and hooks remain.</summary>
[Tool]
public partial class FurnitureVisual : Node3D
{
    [Export] public string Kind {get;set;}="";
    [Export] public string KitId {get;set;}="";
    [Export] public Vector3 ModelSize {get;set;}=Vector3.One;
    [Export] public Vector3 ModelOffset {get;set;}=Vector3.Zero;
    [Export] public float ModelYaw {get;set;}
    [Export] public bool GeometryCollision {get;set;}
    [Export] public bool ResidentSnapshot {get;set;}
    /// <summary>A stored model ("library/node", e.g. "fittings/fireplace_tavern") drawn in place of the recovered meshes, in
    /// the piece's own frame turned by ModelYaw and moved by SceneOffset, at its own size (#187: the taverns' hearths).</summary>
    [Export] public string ModelScene {get;set;}="";
    [Export] public Vector3 SceneOffset {get;set;}=Vector3.Zero;
    /// <summary>How the kit piece was put in (#183): "fit" to the recovered size, "row N" pieces along a recovered row,
    /// "kit" at its own proportions, "recovered" (the recovered construction kept), "" no kit piece. Read by the size check.</summary>
    public string KitFit {get;private set;}="";
    /// <summary>The kit piece's scale on each axis against its own size, and that own size (metres).</summary>
    public Vector3 KitStretch {get;private set;}=Vector3.One;
    public Vector3 KitNatural {get;private set;}=Vector3.Zero;
    /// <summary>The kit piece's size against its own (the same on every axis): casks and clocks come in sizes.</summary>
    public float KitScale {get;private set;}=1;
    /// <summary>The most a kit piece is stretched or squashed on one axis to fit its recovered place.</summary>
    public const float MostStretch=1.35f;
    /// <summary>Marks each kit piece drawn for an item (the size check measures their actual scale).</summary>
    public const string KitPieceMeta="furniture_kit_piece";
    private static bool Fits(float ratio)=>ratio<=MostStretch&&ratio>=1/MostStretch;
    /// <summary>A clock hung on a wall (its foot off the floor, #183: the clock shop's dials at 1 m were taken for longcase clocks).</summary>
    private bool Wall=>ModelOffset.Y>.5f||ModelSize.Y<1.2f;
    private static bool Elongated(Vector3 size)=>Math.Max(size.X,size.Z)>=1.25f*Math.Min(size.X,size.Z);
    /// <summary>A kit piece scaled on each axis, its box's foot centred on `at` (the recovered box's foot centre).</summary>
    private static void Place(Node3D piece,Aabb natural,Vector3 scale,Vector3 at)
    {
        piece.Basis=new Basis(Vector3.Right*scale.X,Vector3.Up*scale.Y,Vector3.Back*scale.Z)*piece.Basis;
        piece.Position=at-new Vector3(natural.GetCenter().X,natural.Position.Y,natural.GetCenter().Z)*scale;
    }
    public override void _Ready()
    {
        if(Engine.IsEditorHint())return;
        // Keep the imported object id/placement editable, but its frozen person is replaced
        // by the live indoor resident. It must contribute neither a mesh nor collision.
        if(ResidentSnapshot)
        {
            Visible=false;
            foreach(var node in Scheldemist.World.BakedWorld.All(this))
            {node.SetMeta("native_replaced_event_snapshot",true);if(node is CollisionObject3D body){body.CollisionLayer=0;body.CollisionMask=0;}if(node is CollisionShape3D shape)shape.Disabled=true;}
            return;
        }
        bool drawn=ModelScene!=""&&DrawModelScene();
        string id=drawn?"":KitId!=""?KitId:Kind switch {
            "chair"=>"chair-ladderback","stool"=>"stool-bar","bench"=>"bench-long","settle"=>"settle",
            "table"=>"table-square","counter"=>"counter-shop","shelf"=>"shelf-wall","cupboard"=>"armoire",
            "bed"=>ModelSize.Y>1.5f?"bed-box":"bed-iron","stove"=>"stove-leuven","clock"=>Wall?"clock-wall":"clock-longcase","washstand"=>"washstand",_=>""};
        // #183: straw on the floor is the straw mattress, not an iron bed squashed flat
        if(Kind=="bed"&&KitId==""&&ModelSize.Y<.45f)id="mattress-straw";
        // A recovered wall rack or fixture group can span a room. Keep its authored
        // construction rather than stretching a standalone kit piece over the shell.
        if(Kind is "shelf" or "cupboard" or "table" && (Math.Max(ModelSize.X,ModelSize.Z)>4.2f || Kind=="table"&&ModelSize.Y>1.5f))id="";
        // A recovered row or loft of casks, or a hall's clock group, spans many pieces (#161: one keg stretched over
        // the whole Vleeshuis roof): it keeps its own casks rather than one stretched keg.
        bool group=Kind switch {"cask"=>ModelSize[(int)ModelSize.MaxAxisIndex()]>2.2f,"clock"=>ModelSize[(int)ModelSize.MaxAxisIndex()]>3f,_=>false};
        if(group){id="";}
        string path=Kind=="cask"?"res://assets/furniture/shared-keg.tscn":"res://assets/furniture/"+id+".tscn";
        var pieces=new System.Collections.Generic.List<Node3D>();
        if(!drawn&&(id!="" || Kind=="cask"&&!group) && ResourceLoader.Exists(path))
        {
            var scene=ResourceLoader.Load<PackedScene>(path);
            bool faced=false;
            if(Kind=="clock" && GetChildren().OfType<MeshInstance3D>().FirstOrDefault(m=>m.Name.ToString().StartsWith("clock_hands")) is {} hands)
            {ModelYaw=Mathf.Atan2(hands.Basis.Z.X,hands.Basis.Z.Z);faced=true;}
            var model=Prepare(scene);
            var bounds=Bounds(model);
            // the kit piece lies the way of the recovered piece, its long side along the recovered long side (#183: the
            // beds' kit pieces lay across their places, squashed to the bed's width and stretched to its length)
            if(!faced&&Kind!="cask"&&bounds is {} turn&&Elongated(turn.Size)&&Elongated(ModelSize)&&turn.Size.X>turn.Size.Z!=ModelSize.X>ModelSize.Z)
            {RemoveChild(model);model.Free();ModelYaw+=Mathf.Pi/2;model=Prepare(scene);bounds=Bounds(model);}
            if(bounds is {} b && b.Size.X>.001f && b.Size.Y>.001f && b.Size.Z>.001f)
            {
                // #183: a kit piece is only fitted to the recovered size when that size is close to its own, or (casks,
                // clocks) of the same shape at another size. A recovered row (bar stools along a counter, two tables
                // pushed together, a long counter) gets kit pieces at their own size along it. Any other misfit keeps its
                // recovered construction rather than one piece stretched out of shape.
                var ratio=ModelSize/b.Size;
                KitNatural=b.Size;
                bool own=GetChildren().OfType<MeshInstance3D>().Any(m=>m.Mesh!=null);
                int axis=ModelSize.X>=ModelSize.Z?0:2;float across=ratio[2-axis];
                float spread=Math.Max(ratio.X,Math.Max(ratio.Y,ratio.Z))/Math.Min(ratio.X,Math.Min(ratio.Y,ratio.Z));
                float size=MathF.Cbrt(ratio.X*ratio.Y*ratio.Z);
                var (smallest,largest)=Kind switch {"cask"=>(.6f,2.4f),"clock"=>(.6f,1.6f),_=>(1/MostStretch,MostStretch)};
                // a table's recovered height can include what stands on it (kept by KeepContents): its top stays at table height
                float tall=Kind=="table"&&ratio.Y>1?1:ratio.Y;
                bool seats=Kind is "stool" or "chair";
                if(Fits(ratio.X)&&Fits(ratio.Y)&&Fits(ratio.Z))
                {
                    Place(model,b,ratio,ModelOffset);pieces.Add(model);
                    KitFit="fit";KitStretch=ratio;
                }
                else if(spread<=MostStretch&&size>=smallest&&size<=largest)
                {
                    Place(model,b,Vector3.One*size,ModelOffset);pieces.Add(model);
                    KitFit="sized";KitStretch=ratio/size;KitScale=size;
                }
                else if(Kind=="clock"&&Wall&&faced)
                {
                    // a wall clock's recovered dial: the kit clock at its own shape, as wide as the dial, hung from the dial's
                    // top with its back on the wall behind it
                    var face=new Vector3(Mathf.Sin(ModelYaw),0,Mathf.Cos(ModelYaw));int thin=Math.Abs(face.X)>Math.Abs(face.Z)?0:2,wide=2-thin;
                    float scale=Math.Clamp(ratio[wide],1/MostStretch,MostStretch);
                    var at=ModelOffset;at.Y=ModelOffset.Y+ModelSize.Y-b.Size.Y*scale;
                    at[thin]=ModelOffset[thin]-face[thin]*ModelSize[thin]/2+face[thin]*b.Size[thin]*scale/2;
                    Place(model,b,Vector3.One*scale,at);pieces.Add(model);
                    KitFit="wall";KitStretch=Vector3.One;KitScale=scale;
                }
                else if(Kind is "stool" or "chair" or "bench" or "counter" or "table" && ratio[axis]>=1.5f && Fits(across) && (seats?ratio.Y is >.6f and <1.6f:Fits(tall)))
                {
                    float length=ModelSize[axis];int count;Vector3 each;
                    var along=axis==0?Vector3.Right:Vector3.Back;
                    if(seats)
                    {
                        // seats stand apart with room for a body between, an odd number keeping one under the row's centre seat
                        float uniform=Math.Clamp((across+ratio.Y)/2,.9f,1.1f);
                        count=Math.Max(1,(int)Math.Floor(length/(b.Size[axis]*uniform*1.7f)));
                        if(count%2==0)count=Math.Max(1,count-1);
                        each=Vector3.One*uniform;
                    }
                    else
                    {
                        // counters, benches and tables stand end to end, each fitted to its share of the length
                        count=Math.Max(1,(int)Math.Round(length/b.Size[axis]));
                        each=ratio;each[axis]=length/count/b.Size[axis];each.Y=tall;
                        if(!Fits(each[axis])){count=Math.Max(1,(int)Math.Ceiling(length/(b.Size[axis]*MostStretch)));each[axis]=length/count/b.Size[axis];}
                    }
                    for(int i=0;i<count;i++)
                    {
                        var piece=i==0?model:Prepare(scene);
                        Place(piece,b,each,ModelOffset+along*(-length/2+(i+.5f)*length/count));pieces.Add(piece);
                    }
                    KitFit="row "+count;KitStretch=seats?Vector3.One:each;KitScale=seats?each.X:1;
                }
                else if(own){RemoveChild(model);model.Free();KitFit="recovered";}
                else
                {
                    // nothing recovered to fall back on: the kit piece at its own proportions, as near the size as it goes
                    float uniform=Math.Clamp(Math.Min(ratio.X,Math.Min(ratio.Y,ratio.Z)),1/MostStretch,MostStretch);
                    Place(model,b,Vector3.One*uniform,ModelOffset);pieces.Add(model);
                    KitFit="kit";KitStretch=Vector3.One;KitScale=uniform;
                }
                if(pieces.Count>0)HideRecovered();
            }
            else {HideRecovered();pieces.Add(model);}
            if(pieces.Count>0&&Kind=="counter")
            {
                foreach(var existingBody in GetChildren().OfType<CollisionObject3D>().ToArray()){RemoveChild(existingBody);existingBody.Free();}
                var faces=new System.Collections.Generic.List<Vector3>();
                foreach(var mesh in pieces.SelectMany(Scheldemist.World.BakedWorld.All).OfType<MeshInstance3D>().Where(m=>m.Mesh!=null&&m.IsVisibleInTree()))
                {
                    var transform=GlobalTransform.AffineInverse()*mesh.GlobalTransform;
                    faces.AddRange(mesh.Mesh!.GetFaces().Select(p=>transform*p));
                }
                var shape=new ConcavePolygonShape3D{BackfaceCollision=true};shape.SetFaces(faces.ToArray());
                var body=new StaticBody3D{Name="ModelSolid",CollisionLayer=2,CollisionMask=0};body.AddChild(new CollisionShape3D{Name="Shape",Shape=shape});AddChild(body);
            }
        }
        if(GeometryCollision&&Kind!="counter")
        {
            var faces=new System.Collections.Generic.List<Vector3>();
            foreach(var mesh in Scheldemist.World.BakedWorld.All(this).OfType<MeshInstance3D>().Where(m=>m.Mesh!=null&&m.IsVisibleInTree()))
            {
                var transform=GlobalTransform.AffineInverse()*mesh.GlobalTransform;
                var vertices=mesh.Mesh!.GetFaces();
                for(int i=0;i+2<vertices.Length;i+=3)
                {
                    var a=transform*vertices[i];var b=transform*vertices[i+1];var c=transform*vertices[i+2];
                    if(a.IsFinite()&&b.IsFinite()&&c.IsFinite()&&(b-a).Cross(c-a).LengthSquared()>1e-10f){faces.Add(a);faces.Add(b);faces.Add(c);}
                }
            }
            if(faces.Count>0)
            {
                foreach(var existingBody in GetChildren().OfType<CollisionObject3D>().ToArray()){RemoveChild(existingBody);existingBody.Free();}
                var shape=new ConcavePolygonShape3D{BackfaceCollision=true};shape.SetFaces(faces.ToArray());
                var body=new StaticBody3D{Name="GeometrySolid",CollisionLayer=2,CollisionMask=0};body.AddChild(new CollisionShape3D{Name="Shape",Shape=shape});AddChild(body);
            }
        }
        if(Scheldemist.Movers.Clocks.I is {} clocks && IsInstanceValid(clocks) && clocks.IsInsideTree())
            foreach(var dial in Scheldemist.World.BakedWorld.All(this).OfType<Node3D>().Where(n=>n.Name.ToString().EndsWith("_dial")))clocks.AdoptDial(dial,"furniture dial",Kind);
        if(Scheldemist.Main.I?.World is Native.World.NativeTown)
            Native.World.NativeTownMaterials.Furniture.ApplyObject(this);
    }
    private bool DrawModelScene()
    {
        var parts=ModelScene.Split('/');
        if(parts.Length!=2||Scheldemist.Models.ModelLibrary.Get(parts[0],new Scheldemist.Models.ModelLibrary.Look(TwoSided:true,Affine:0,VertexColor:true))?.Copy(parts[1]) is not {} model)return false;
        HideRecovered();
        foreach(var child in model.FindChildren("*","CollisionObject3D",true,false).OfType<CollisionObject3D>().ToArray()){child.GetParent().RemoveChild(child);child.Free();}
        model.Transform=new Transform3D(new Basis(Vector3.Up,ModelYaw),SceneOffset);AddChild(model);
        KitFit="model";return true;
    }
    private Node3D Prepare(PackedScene scene)
    {
        var model=scene.Instantiate<Node3D>();
        foreach(var child in model.FindChildren("*","CollisionObject3D",true,false).OfType<CollisionObject3D>().ToArray())
        {child.GetParent().RemoveChild(child);child.Free();}
        model.Rotation=new(0,ModelYaw,0);model.SetMeta(KitPieceMeta,true);AddChild(model);
        if(Kind=="cask")
        {
            if(ModelSize.X>ModelSize.Y*1.1f)model.RotateZ(Mathf.Pi/2);
            else if(ModelSize.Z>ModelSize.Y*1.1f)model.RotateX(Mathf.Pi/2);
        }
        foreach(var far in model.FindChildren("*_far","Node3D",true,false).OfType<Node3D>())far.Visible=false;
        return model;
    }
    private Aabb? Bounds(Node3D model)
    {
        Aabb? box=null;
        foreach(var mesh in Scheldemist.World.BakedWorld.All(model).OfType<MeshInstance3D>().Where(m=>m.Mesh!=null && m.IsVisibleInTree()))
        {
            var bounds=GlobalTransform.AffineInverse()*mesh.GlobalTransform*mesh.GetAabb();box=box.HasValue?box.Value.Merge(bounds):bounds;
        }
        return box;
    }
    private void HideRecovered()
    {
        foreach(var child in GetChildren().OfType<GeometryInstance3D>())
        {
            child.Visible=false;child.SetMeta("native_replaced_visual",true);
            if(child is MeshInstance3D mesh && Kind is "table" or "counter") KeepContents(mesh,Kind=="table"?.8f:1.1f);
        }
    }
    private void KeepContents(MeshInstance3D source,float surfaceHeight)
    {
        if(source.Mesh==null)return;
        for(int surface=0;surface<source.Mesh.GetSurfaceCount();surface++)
        {
            var arrays=source.Mesh.SurfaceGetArrays(surface);var vertices=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            var index=arrays[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.Nil?Enumerable.Range(0,vertices.Length).ToArray():arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
            var retained=new System.Collections.Generic.List<int>();
            for(int i=0;i+2<index.Length;i+=3)
                if(Enumerable.Range(0,3).All(k=>(source.Transform*vertices[index[i+k]]).Y>surfaceHeight))retained.AddRange(index.Skip(i).Take(3));
            if(retained.Count==0)continue;
            var own=new Godot.Collections.Array();own.Resize((int)Mesh.ArrayType.Max);own[(int)Mesh.ArrayType.Vertex]=retained.Select(i=>vertices[i]).ToArray();
            if(arrays[(int)Mesh.ArrayType.Normal].VariantType!=Variant.Type.Nil){var n=arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();own[(int)Mesh.ArrayType.Normal]=retained.Select(i=>n[i]).ToArray();}
            if(arrays[(int)Mesh.ArrayType.TexUV].VariantType!=Variant.Type.Nil){var uv=arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();own[(int)Mesh.ArrayType.TexUV]=retained.Select(i=>uv[i]).ToArray();}
            if(arrays[(int)Mesh.ArrayType.Color].VariantType!=Variant.Type.Nil){var c=arrays[(int)Mesh.ArrayType.Color].AsColorArray();own[(int)Mesh.ArrayType.Color]=retained.Select(i=>c[i]).ToArray();}
            var mesh=new ArrayMesh();mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,own);mesh.SurfaceSetMaterial(0,source.Mesh.SurfaceGetMaterial(surface));
            AddChild(new MeshInstance3D{Name="Contents",Mesh=mesh,Transform=source.Transform});
        }
    }
}
