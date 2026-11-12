using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.World;
using Scheldemist.World.Ruien;
public partial class RuienGateNetworkProbe:Node3D
{
    public override async void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string output=args[Array.IndexOf(args,"--out")+1];
            var gates=RuienNetworkGates.Read();AddChild(gates.Build());var checks=new List<object>();int failures=0;
            using var shape=new CapsuleShape3D{Radius=.464f,Height=3.86f};
            foreach(bool closed in new[]{false,true})
            {
                gates.Update(0,closed?-.4f:-5.2f);
                for(int i=0;i<3;i++)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
                var space=GetWorld3D().DirectSpaceState;
                foreach(var gate in gates.Specs)
                {
                    bool boundary=closed||gate.Held||gate.Flush;int blocked=0,unsupported=0;var errors=new List<object>();
                    for(float z=-.2f;z<=5.8f;z+=.1f)
                    {
                        float mix=Math.Clamp((z-1.5f)/4.5f,0,1),y=Mathf.Lerp(gate.Sill,gate.Bed,mix);
                        var p=gate.Frame*new Vector3(gate.IncomingOffset*mix,y,z);
                        float ground=float.NegativeInfinity;
                        foreach(var offset in new[]{Vector2.Zero,new Vector2(.12f,0),new Vector2(-.12f,0),new Vector2(0,.12f),new Vector2(0,-.12f)})
                        {
                            var q=p+new Vector3(offset.X,0,offset.Y);var ray=space.IntersectRay(PhysicsRayQueryParameters3D.Create(q+Vector3.Up*.3f,q-Vector3.Up*.35f,Solid.Layer));
                            if(ray.Count>0&&ray["normal"].AsVector3().Y>.5f)ground=Math.Max(ground,ray["position"].AsVector3().Y);
                        }
                        if(float.IsFinite(ground))p.Y=ground+.012f;
                        else if(!boundary){unsupported++;errors.Add(new{z,error="no bed support"});continue;}
                        using var query=new PhysicsShapeQueryParameters3D{Shape=shape,CollisionMask=Solid.Layer,Margin=0,Transform=new Transform3D(Basis.Identity,p+Vector3.Up*1.93f)};
                        var hits=space.IntersectShape(query,8);
                        if(hits.Count>0){blocked++;if(!boundary)errors.Add(new{z,at=p.ToString(),hits=hits.Select(h=>(h["collider"].AsGodotObject()as Node)?.GetPath().ToString()).ToArray(),contacts=space.CollideShape(query,3).Select(x=>x.ToString()).ToArray()});}
                    }
                    bool pass=boundary?blocked>0:blocked+unsupported==0;if(!pass)failures++;
                    checks.Add(new{id=gate.Id,closed,boundary,pass,blocked,unsupported,errors});
                }
            }
            // The F1 fall ends on the receiving water; its sound follows the
            // same wet/dry state, including a submerged inlet at high water.
            foreach(var gate in gates.Specs.Where(s=>s.Flush))
            {
                var film=GetNode<MeshInstance3D>("ruien_network_gates/gate_"+gate.Id+"/flush_fall");
                foreach(var (river,water,visible) in new[]{(-5.2f,gate.Water,false),(-.4f,gate.Water,true),(-.4f,gate.Sill-.2f,true),(-.4f,gate.Sill+.1f,false)})
                {
                    gates.Update(0,river,_=>water);
                    bool pass=film.Visible==visible&&(!visible||MathF.Abs(film.Position.Y-film.Scale.Y-(water+.02f))<.001f)
                        &&gates.SoundPoints.All(p=>p.Flowing?.Invoke()==visible);
                    if(!pass)failures++;checks.Add(new{id=gate.Id,river,water,visible,pass,check="flush fall and sound"});
                }
            }
            File.WriteAllText(output,JsonSerializer.Serialize(new{failures,checks},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"GATE NETWORK PROBE: {failures} failures");GetTree().Quit(failures==0?0:1);
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
