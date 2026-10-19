using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Net;
using Scheldemist.People;

namespace Scheldemist.World.Ruien;

/// <summary>The maintenance crew follows the same native stair/ledge route and waits for its lids.</summary>
[GamePart(924)]
public partial class RuienWorkmen : Node
{
    public static bool ProofActive;
    private sealed class Worker
    {
        public Human Human=null!;
        public Vector3 From,To;
        public float T;
        public bool Moving,Working;
    }
    private readonly Dictionary<string,Worker> crew=new();
    private float poll;
    private bool pending;
    public override void _Process(double delta)
    {
        // The physics proof controls the lids itself, then exercises the crew separately through native rules.
        if(Main.I.Arg("ruien-proof").Length>0&&!ProofActive)return;
        float dt=(float)delta;
        if((poll-=dt)<=0&&!pending&&ServerLink.I?.Api is{} api)
        {
            poll=.5f;pending=true;
            api.Run(api.Get<JsonElement>("api/ruien/crew"),data=>{
                pending=false;
                foreach(var row in data.EnumerateArray())
                {
                    string id=row.GetProperty("id").GetString()!;
                    var at=new Vector3(row.GetProperty("x").GetSingle(),row.GetProperty("y").GetSingle(),row.GetProperty("z").GetSingle());
                    if(!crew.TryGetValue(id,out var worker))
                    {
                        var human=Humans.Make(id.EndsWith("_0")?"docker_a":"docker_b");if(human==null)continue;
                        worker=new Worker{Human=human,From=at,To=at};crew[id]=worker;
                        Main.I.View.AddChild(human.Root);human.Root.Name=id;human.Root.Position=at;human.Start();
                    }
                    worker.From=worker.Human.Root.Position;worker.To=at;worker.T=0;
                    worker.Moving=row.GetProperty("moving").GetBoolean();worker.Working=row.GetProperty("working").GetBoolean();
                }
            },_=>pending=false);
        }
        foreach(var worker in crew.Values)
        {
            worker.T=Math.Min(1,worker.T+dt/.5f);var p=worker.From.Lerp(worker.To,worker.T);
            var direction=worker.To-worker.From;
            if(new Vector2(direction.X,direction.Z).LengthSquared()>.0001f)
                worker.Human.Root.Rotation=new Vector3(0,MathF.Atan2(-direction.X,-direction.Z),0);
            // Snap the interpolated feet to the actual treads, so ascent never follows an invisible ramp.
            var query=PhysicsRayQueryParameters3D.Create(p+Vector3.Up*.24f,p-Vector3.Up*.25f,Solid.Layer);
            var hit=Main.I.View.FindWorld3D().DirectSpaceState.IntersectRay(query);
            if(hit.Count>0)p.Y=hit["position"].AsVector3().Y;
            worker.Human.Root.Position=p;worker.Human.Play(worker.Moving?"walk":worker.Working?"pull":"idle");worker.Human.Update(dt);
        }
    }
}
