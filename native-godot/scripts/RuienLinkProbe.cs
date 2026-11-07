using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Collections.Generic;
using Godot;
using Scheldemist.World;
using Scheldemist.World.Ruien;

// Bounded physics proof of R1's import, native doorway and clipped town resources, without game/services startup.
public partial class RuienLinkProbe : Node3D
{
    public override async void _Ready()
    {
        try
        {
            var s=RuienEntrance.All.Single(e=>e.Id=="r1_paulus");
            var entrance=RuienEntrance.Build(s);entrance.Name="entrance";
            var leaf=entrance.GetNode("door");entrance.RemoveChild(leaf);leaf.Free();AddChild(entrance);
            string family="";int part=0;
            foreach(var child in entrance.GetChildren())
            {
                if(child is MeshInstance3D mi&&mi.Mesh is ArrayMesh am)family=am.SurfaceGetName(0);
                if(child is StaticBody3D b)b.Name=$"part_{part++}_{family}";
            }
            var body=new StaticBody3D{Name="r1_import",CollisionLayer=Solid.Layer,CollisionMask=0};
            body.AddChild(new CollisionShape3D{Shape=ResourceLoader.Load<Shape3D>("res://world/ruien/r1/collision.res")});AddChild(body);
            var town=ResourceLoader.Load<PackedScene>("res://world/town/scene.tscn").Instantiate<Node3D>();AddChild(town);
            ((List<RuienEntrance.Spec>)RuienEntrance.All).RemoveAll(e=>e.Id!=s.Id);
            RuienEntrance.Cut(town);
            var center=RuienEntrance.ClosureFront(s,0);
            var region=new Aabb(center-new Vector3(5,0,3),new Vector3(10,7,13));
            foreach(var mi in BakedWorld.All(town).OfType<MeshInstance3D>())
            {
                if(mi.Mesh==null || !(mi.GlobalTransform*mi.GetAabb()).Intersects(region))continue;
                var faces=mi.Mesh.HasMeta("native_solid_stand_in")?mi.Mesh.GetMeta("native_solid_stand_in").AsVector3Array():mi.Mesh.GetFaces();
                var near=new List<Vector3>();
                for(int k=0;k+2<faces.Length;k+=3)
                {
                    var a=mi.GlobalTransform*faces[k];var b=mi.GlobalTransform*faces[k+1];var c0=mi.GlobalTransform*faces[k+2];
                    var bb=new Aabb(a,Vector3.Zero).Expand(b).Expand(c0);
                    if(bb.Intersects(region))near.AddRange(new[]{a,b,c0});
                }
                if(near.Count==0)continue;
                var wall=new StaticBody3D{Name="town_"+mi.Name,CollisionLayer=Solid.Layer,CollisionMask=0};
                wall.SetMeta("path",town.GetPathTo(mi).ToString());
                wall.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=near.ToArray(),BackfaceCollision=true}});AddChild(wall);
            }
            for(int i=0;i<5;i++)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
            var world=GetWorld3D().DirectSpaceState;
            var c=RuienEntrance.ClosureFront(s,0);
            var normal=s.Local.Basis*s.ClosureWall.Basis.Z;
            var rows=new List<object>();
            int blocked=0;
            foreach(var feet in new[]{new Vector3(164.08409f,-.5317995f,300.4042f),new Vector3(164.12471f,-.70910007f,300.2415f),new Vector3(164.16534f,-.7091f,300.07877f)})
            {
                var q=new PhysicsShapeQueryParameters3D{Shape=new CylinderShape3D{Radius=.32f,Height=1.75f-.36f},Transform=new Transform3D(Basis.Identity,feet+Vector3.Up*(.05f+.36f+(1.75f-.36f)/2)),CollisionMask=Solid.Layer,Margin=0};
                var hits=world.IntersectShape(q,16);blocked+=hits.Count>0?1:0;
                rows.Add(new{feet=feet.ToString(),bodyHits=hits.Select(h=>(h["collider"].AsGodotObject() as Node)?.Name.ToString()).Distinct().ToArray()});
            }
            foreach(float d in new[]{-.7f,-.4f,-.2f,0,.2f,.4f,.7f})
            {
                var at=c+normal*d+Vector3.Up*(.05f+.36f+(1.75f-.36f)/2);
                var q=new PhysicsShapeQueryParameters3D{Shape=new CylinderShape3D{Radius=.32f,Height=1.75f-.36f},Transform=new Transform3D(Basis.Identity,at),CollisionMask=Solid.Layer,Margin=0};
                var hits=world.IntersectShape(q,16);blocked+=hits.Count>0?1:0;
                rows.Add(new{d,bodyHits=hits.Select(h=>(h["collider"].AsGodotObject() as Node)?.Name.ToString()).Distinct().ToArray()});
            }
            foreach(float h in new[]{.1f,.7f,1.3f,1.6f,1.75f})
            {
                var from=c-normal*.8f+Vector3.Up*h;var to=c+normal*.8f+Vector3.Up*h;
                var q=PhysicsRayQueryParameters3D.Create(from,to,Solid.Layer);q.HitBackFaces=true;
                var hit=world.IntersectRay(q);
                rows.Add(new{height=h,hit=hit.Count>0,at=hit.Count>0?hit["position"].AsVector3().ToString():"",node=hit.Count>0?(hit["collider"].AsGodotObject() as Node)?.GetPath().ToString():""});
            }
            var args=OS.GetCmdlineUserArgs();string output=args.Length>0?args[0]:ProjectSettings.GlobalizePath("user://ruien-link-proof.json");
            File.WriteAllText(output,JsonSerializer.Serialize(rows,new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"RUIEN LINK PROOF {(blocked==0?"PASS":"FAIL")}: {blocked} blocked body samples");GetTree().Quit(blocked==0?0:1);
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
