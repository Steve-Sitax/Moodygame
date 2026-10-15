using Godot;
using System;
using System.Collections.Generic;
using System.Linq;

namespace Scheldemist.Native.Characters;

/// <summary>
/// A physics body for a person thrown by Antigoon, built on the person's own skeleton with Godot's ragdoll system.
/// Each part weighs its real share of the body (Winter's segment table) and each joint keeps to a human range,
/// so a body that comes to rest lies the way a body lies: knees and elbows bend only forward, no neck snaps round.
/// </summary>
public partial class HumanRagdoll : PhysicalBoneSimulator3D
{
    public enum Kind { Cone, Hinge }
    /// <summary>One body part: its bone, the bone it reaches toward, its share of the weight, its thickness and its joint.</summary>
    public sealed record Part(string Bone,string Child,float Share,float Radius,Kind Joint,float Swing,float Twist);
    public const uint Layer=1u<<19;
    /// <summary>The people2 (MakeHuman) rig. Shares add up to 1; swing and twist in degrees. A hinge folds from 0 to
    /// `Swing`; a negative swing folds the other way (a knee folds the opposite way to an elbow).</summary>
    public static readonly Part[] People2=
    {
        new("hips","spine",.142f,.13f,Kind.Cone,0,0),
        new("spine","chest",.139f,.13f,Kind.Cone,25,15),
        new("chest","upperChest",.108f,.14f,Kind.Cone,18,12),
        new("upperChest","neck",.108f,.14f,Kind.Cone,14,10),
        new("neck","head",.012f,.05f,Kind.Cone,30,30),
        new("head","headTop",.069f,.1f,Kind.Cone,25,25),
        new("armUpL","armLowL",.028f,.045f,Kind.Cone,80,45),new("armUpR","armLowR",.028f,.045f,Kind.Cone,80,45),
        new("armLowL","handL",.016f,.038f,Kind.Hinge,140,0),new("armLowR","handR",.016f,.038f,Kind.Hinge,140,0),
        new("handL","handL",.006f,.035f,Kind.Cone,45,15),new("handR","handR",.006f,.035f,Kind.Cone,45,15),
        new("legUpL","legLowL",.1f,.075f,Kind.Cone,65,25),new("legUpR","legLowR",.1f,.075f,Kind.Cone,65,25),
        new("legLowL","footL",.0465f,.055f,Kind.Hinge,-140,0),new("legLowR","footR",.0465f,.055f,Kind.Hinge,-140,0),
        new("footL","toeL",.0145f,.045f,Kind.Cone,30,10),new("footR","toeR",.0145f,.045f,Kind.Cone,30,10),
    };
    /// <summary>Hinge bend axis in the bone's own frame (knees and elbows fold about the bone's side axis).</summary>
    public static Vector3 HingeAxis = Vector3.Right;
    private readonly Dictionary<string,PhysicalBone3D> bodies=new();
    private Skeleton3D skeleton=null!;

    /// <summary>Build the ragdoll on a skeleton for a body of `mass` kg (scale: the person's size).</summary>
    public static HumanRagdoll Attach(Skeleton3D skeleton,Part[] parts,float mass,float scale)
    {
        var ragdoll=new HumanRagdoll{Name="Ragdoll",skeleton=skeleton};skeleton.AddChild(ragdoll);
        foreach(var part in parts)
        {
            int bone=skeleton.FindBone(part.Bone),child=skeleton.FindBone(part.Child);if(bone<0)continue;
            var rest=skeleton.GetBoneGlobalRest(bone);
            float length=child>=0&&child!=bone?rest.Origin.DistanceTo(skeleton.GetBoneGlobalRest(child).Origin):part.Radius*2.2f;
            // The body sits halfway along the bone; the joint stays at the bone's head.
            var along=child>=0&&child!=bone?(skeleton.GetBoneGlobalRest(child).Origin-rest.Origin):rest.Basis.Y*length;
            var local=rest.Basis.Inverse()*along;var middle=local*.5f;
            // Very light parts (neck, hands) make the solver let joints drift; keep every part at least a kilogram.
            var body=new PhysicalBone3D{Name="Body_"+part.Bone,Mass=Math.Max(1f,part.Share*mass),Friction=.9f,Bounce=.02f,
                LinearDamp=.08f,AngularDamp=1.2f,CollisionLayer=Layer,CollisionMask=1,CanSleep=true};
            var shape=new CollisionShape3D{Shape=new CapsuleShape3D{Radius=part.Radius*scale,Height=Math.Max(part.Radius*2.05f*scale,length)}};
            // Capsules stand along their Y axis: turn Y onto the bone's own direction.
            shape.Transform=new Transform3D(new Basis(new Quaternion(Vector3.Up,local.Normalized())),Vector3.Zero);
            body.Set("bone_name",part.Bone);body.AddChild(shape);
            body.BodyOffset=new Transform3D(Basis.Identity,middle);
            body.JointOffset=new Transform3D(Basis.Identity,-middle);
            if(part.Swing!=0)
            {
                if(part.Joint==Kind.Hinge)
                {
                    body.JointType=PhysicalBone3D.JointTypeEnum.Hinge;
                    // Godot's hinge turns about its joint Z axis: lay that onto the bone's bend axis.
                    body.JointRotation=new Basis(new Quaternion(Vector3.Back,HingeAxis)).GetEuler();
                    body.Set("joint_constraints/angular_limit_enabled",true);
                    body.Set("joint_constraints/angular_limit_lower",Math.Min(0,part.Swing));body.Set("joint_constraints/angular_limit_upper",Math.Max(0,part.Swing));
                }
                else
                {
                    body.JointType=PhysicalBone3D.JointTypeEnum.Cone;
                    body.Set("joint_constraints/swing_span",part.Swing);body.Set("joint_constraints/twist_span",part.Twist);
                }
            }
            ragdoll.AddChild(body);ragdoll.bodies[part.Bone]=body;
        }
        ragdoll.Active=false;
        // After the physics: every bone back to its own length, every joint inside its human range.
        var keeper=new RagdollShape{Name="RagdollShape",Ragdoll=ragdoll,Parts=parts};skeleton.AddChild(keeper);
        return ragdoll;
    }
    /// <summary>
    /// Hang by `bone` from a point that follows `grip` (a giant's fist): a hidden handle body there holds the bone
    /// with a pin joint, so the whole body swings from it under its own weight.
    /// </summary>
    public void Hang(string bone,Func<Vector3> grip)
    {
        Active=true;Influence=1;PhysicalBonesStartSimulation();
        if(!bodies.TryGetValue(bone,out var held))return;
        this.grip=grip;
        handle=new AnimatableBody3D{Name="Handle",CollisionLayer=0,CollisionMask=0,SyncToPhysics=false,TopLevel=true};AddChild(handle);handle.GlobalPosition=held.GlobalPosition;
        pin=new PinJoint3D{Name="Grip",TopLevel=true};AddChild(pin);pin.GlobalPosition=held.GlobalPosition;
        pin.NodeA=pin.GetPathTo(handle);pin.NodeB=pin.GetPathTo(held);
    }
    private Func<Vector3>? grip;
    private AnimatableBody3D? handle;
    private PinJoint3D? pin;
    private void LetGo(){pin?.QueueFree();handle?.QueueFree();pin=null;handle=null;grip=null;}
    /// <summary>Let go of everything and send the whole body along `velocity`.</summary>
    public void Fling(Vector3 velocity,Vector3 spin)
    {
        // Join the held bones to the running simulation (a restart would reset every body to the pose);
        // the throw's speed goes in on the next physics step, once all bodies are live.
        LetGo();Active=true;Influence=1;PhysicalBonesStartSimulation();
        pending=(velocity,spin);
    }
    private (Vector3 Velocity,Vector3 Spin)? pending;
    private int pushes;
    public override void _PhysicsProcess(double delta)
    {
        if(handle!=null&&grip!=null)handle.GlobalPosition=grip();
        if(pending is not {} toss)return;
        if(++pushes<2)return;pending=null;pushes=0;
        // Momentum, not a set speed: every part gets its own weight's worth of the throw.
        foreach(var body in bodies.Values){body.ApplyCentralImpulse(toss.Velocity*body.Mass);body.AngularVelocity=toss.Spin;}
    }
    public void Release(){LetGo();PhysicalBonesStopSimulation();Active=false;}
    /// <summary>All parts nearly still.</summary>
    public bool Settled=>bodies.Values.All(b=>b.LinearVelocity.Length()<.25f);
    public Vector3 Centre=>bodies.TryGetValue("hips",out var hips)?hips.GlobalPosition:skeleton.GlobalPosition;
    public IEnumerable<string> Parts=>bodies.Keys;
    public PhysicalBone3D? Body(string bone)=>bodies.GetValueOrDefault(bone);
}

/// <summary>
/// Runs after the ragdoll: puts every simulated bone back at its rest length (only the root may travel) and clamps
/// each joint to its range, split into the swing of the bone and its twist about itself. Whatever the solver does,
/// limbs never stretch and joints never pass a human limit.
/// </summary>
public partial class RagdollShape : SkeletonModifier3D
{
    public HumanRagdoll Ragdoll=null!;
    public HumanRagdoll.Part[] Parts=Array.Empty<HumanRagdoll.Part>();
    /// <summary>Proof aid: the final pose as drawn, skeleton space, per bone.</summary>
    public readonly Dictionary<int,Transform3D> Final=new();
    public override void _ProcessModificationWithDelta(double delta)
    {
        if(!Ragdoll.Active)return;
        var skeleton=GetSkeleton();if(skeleton==null)return;
        try{Shape(skeleton);}finally{for(int b=0;b<skeleton.GetBoneCount();b++)Final[b]=skeleton.GetBoneGlobalPose(b);}
    }
    private void Shape(Skeleton3D skeleton)
    {
        foreach(var part in Parts)
        {
            int bone=skeleton.FindBone(part.Bone);if(bone<0||skeleton.GetBoneParent(bone)<0)continue;
            var rest=skeleton.GetBoneRest(bone);
            if(part.Swing!=0||part.Joint==HumanRagdoll.Kind.Cone)skeleton.SetBonePosePosition(bone,rest.Origin);
            if(part.Swing==0)continue;
            var restTurn=rest.Basis.GetRotationQuaternion();
            var turn=(restTurn.Inverse()*skeleton.GetBonePoseRotation(bone).Normalized()).Normalized();
            skeleton.SetBonePoseRotation(bone,(restTurn*Clamp(turn,part)).Normalized());
        }
    }
    private static Quaternion Clamp(Quaternion q,HumanRagdoll.Part part)
    {
        if(q.W<0)q=-q;
        if(part.Joint==HumanRagdoll.Kind.Hinge)
        {
            // Keep only the fold about the hinge axis, inside its range.
            var axis=HumanRagdoll.HingeAxis;float s=new Vector3(q.X,q.Y,q.Z).Dot(axis);
            float angle=2*Mathf.Atan2(s,q.W);
            // Measured on the people2 rig: the physics hinge's positive fold is a turn about the bone's -X.
            float lo=Mathf.DegToRad(Math.Min(0,-part.Swing)),hi=Mathf.DegToRad(Math.Max(0,-part.Swing));
            return new Quaternion(axis,Math.Clamp(angle,lo,hi));
        }
        // Swing-twist about the bone's own (Y) axis.
        var twist=new Quaternion(0,q.Y,0,q.W);twist=twist.LengthSquared()<1e-8f?Quaternion.Identity:twist.Normalized();
        var swing=(q*twist.Inverse()).Normalized();
        float twistAngle=2*Mathf.Atan2(twist.Y,twist.W),swingAngle=2*Mathf.Acos(Math.Clamp(Math.Abs(swing.W),0,1));
        float maxTwist=Mathf.DegToRad(part.Twist),maxSwing=Mathf.DegToRad(part.Swing);
        if(Math.Abs(twistAngle)>maxTwist)twist=new Quaternion(Vector3.Up,Math.Sign(twistAngle)*maxTwist);
        if(swingAngle>maxSwing){var axis=new Vector3(swing.X,swing.Y,swing.Z);if(swing.W<0)axis=-axis;if(axis.LengthSquared()>1e-10f)swing=new Quaternion(axis.Normalized(),maxSwing);}
        return (swing*twist).Normalized();
    }
}
