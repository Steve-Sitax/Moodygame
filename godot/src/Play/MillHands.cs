using System;
using Godot;
using Scheldemist.Game;
namespace Scheldemist.Play;
/// <summary>The shoulder/spoke and hand-over-hand actions, prepared before play.</summary>
[GamePart(921)]
public partial class MillHands : Node
{
    private Node3D arms=null!,left=null!,right=null!;
    public override void _Ready()
    {
        arms=new Node3D{Name="mill_work_hands",Visible=false};Main.I.Cam.AddChild(arms);
        left=Arm(-1);right=Arm(1);
    }
    private Node3D Arm(int sign)
    {
        var root=new Node3D();arms.AddChild(root);
        root.AddChild(new MeshInstance3D{Mesh=new CylinderMesh{TopRadius=.052f,BottomRadius=.065f,Height=.36f,RadialSegments=6},MaterialOverride=Goods.I.Plain(0x5a4430),Position=new(sign*.26f,-.35f,-.45f),Rotation=new(MathF.PI/2-.25f,0,sign*.2f)});
        root.AddChild(new MeshInstance3D{Mesh=new SphereMesh{Radius=.065f,Height=.13f,RadialSegments=6,Rings=3},MaterialOverride=Goods.I.Plain(0xc88a6a),Position=new(sign*.26f,-.28f,-.64f)});return root;
    }
    public override void _Process(double dt)
    {
        if(Jobs.I.Run is not MillWork{Turning:true} work){arms.Visible=false;return;}
        arms.Visible=true;float t=work.TurnFraction*5;
        if(work.Capstan){left.Position=new(MathF.Sin(t*1.2f)*.035f,MathF.Cos(t*1.2f)*.02f,-.06f);right.Position=left.Position;arms.Rotation=new(0,0,MathF.Sin(t*1.2f)*.04f);}
        else{left.Position=Vector3.Up*MathF.Sin(t*4)*.12f;right.Position=-left.Position;arms.Rotation=Vector3.Zero;}
    }
    public override void _ExitTree(){arms.QueueFree();}
}
