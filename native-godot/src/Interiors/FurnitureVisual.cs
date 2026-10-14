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
    public override void _Ready()
    {
        if(Engine.IsEditorHint())return;
        string id=KitId!=""?KitId:Kind switch {
            "chair"=>"chair-ladderback","stool"=>"stool-bar","bench"=>"bench-long","settle"=>"settle",
            "table"=>"table-square","counter"=>"counter-shop","shelf"=>"shelf-wall","cupboard"=>"armoire",
            "bed"=>ModelSize.Y>1.5f?"bed-box":"bed-iron","stove"=>"stove-leuven","clock"=>ModelOffset.Y>1?"clock-wall":"clock-longcase","washstand"=>"washstand",_=>""};
        if(Kind=="bed"&&ModelSize.X>ModelSize.Z)ModelYaw+=Mathf.Pi/2;
        // A recovered wall rack or fixture group can span a room. Keep its authored
        // construction rather than stretching a standalone kit piece over the shell.
        if(Kind is "shelf" or "cupboard" or "table" && (Math.Max(ModelSize.X,ModelSize.Z)>4.2f || Kind=="table"&&ModelSize.Y>1.5f))id="";
        string path=Kind=="cask"?"res://assets/furniture/shared-keg.tscn":"res://assets/furniture/"+id+".tscn";
        if((id!="" || Kind=="cask") && ResourceLoader.Exists(path))
        {
            var model=ResourceLoader.Load<PackedScene>(path).Instantiate<Node3D>();
            if(Kind=="clock" && GetChildren().OfType<MeshInstance3D>().FirstOrDefault(m=>m.Name.ToString().StartsWith("clock_hands")) is {} hands)
                ModelYaw=Mathf.Atan2(hands.Basis.Z.X,hands.Basis.Z.Z);
            foreach(var child in GetChildren().OfType<GeometryInstance3D>())
            {
                child.Visible=false;child.SetMeta("native_replaced_visual",true);
                if(child is MeshInstance3D mesh && Kind is "table" or "counter") KeepContents(mesh,Kind=="table"?.8f:1.1f);
            }
            foreach(var child in model.FindChildren("*","CollisionObject3D",true,false).OfType<CollisionObject3D>().ToArray())
            {child.GetParent().RemoveChild(child);child.Free();}
            model.Rotation=new(0,ModelYaw,0);AddChild(model);
            if(Kind=="cask")
            {
                if(ModelSize.X>ModelSize.Y*1.1f)model.RotateZ(Mathf.Pi/2);
                else if(ModelSize.Z>ModelSize.Y*1.1f)model.RotateX(Mathf.Pi/2);
            }
            foreach(var far in model.FindChildren("*_far","Node3D",true,false).OfType<Node3D>())far.Visible=false;
            Aabb? box=null;
            foreach(var mesh in Scheldemist.World.BakedWorld.All(model).OfType<MeshInstance3D>().Where(m=>m.Mesh!=null && m.IsVisibleInTree()))
            {
                var bounds=GlobalTransform.AffineInverse()*mesh.GlobalTransform*mesh.GetAabb();box=box.HasValue?box.Value.Merge(bounds):bounds;
            }
            if(box is {} b && b.Size.X>.001f && b.Size.Y>.001f && b.Size.Z>.001f)
            {
                var scale=ModelSize/b.Size;
                model.Basis=new Basis(Vector3.Right*scale.X,Vector3.Up*scale.Y,Vector3.Back*scale.Z)*model.Basis;
                model.Position=ModelOffset-new Vector3(b.GetCenter().X,b.Position.Y,b.GetCenter().Z)*scale;
            }
            if(Kind=="counter")
            {
                foreach(var existingBody in GetChildren().OfType<CollisionObject3D>().ToArray()){RemoveChild(existingBody);existingBody.Free();}
                var faces=new System.Collections.Generic.List<Vector3>();
                foreach(var mesh in Scheldemist.World.BakedWorld.All(model).OfType<MeshInstance3D>().Where(m=>m.Mesh!=null&&m.IsVisibleInTree()))
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
