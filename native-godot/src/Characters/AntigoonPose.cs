using Godot;
using System;
using Scheldemist.Native.Services;

namespace Scheldemist.Native.Characters;

/// <summary>Terrain foot planting, a complete stance/swing gait, shielding and quiet attention after animation.</summary>
public partial class AntigoonPose : SkeletonModifier3D
{
    public AntigoonActor Actor=null!;
    private Skeleton3D rig=null!;
    private readonly int[] hips=new int[2],knees=new int[2],ankles=new int[2],arms=new int[2],elbows=new int[2],hands=new int[2];
    private readonly Transform3D[] restFeet=new Transform3D[2],restHands=new Transform3D[2];
    private readonly float[] floor=new float[2],slope=new float[2];
    private int head,chest,pelvis;
    private double clock;
    public override void _Ready()
    {
        rig=GetSkeleton();head=rig.FindBone("head");chest=rig.FindBone("chest");pelvis=rig.FindBone("pelvis");
        for(int i=0;i<2;i++)
        {
            string side=i==0?"L":"R";
            hips[i]=rig.FindBone("thigh."+side);knees[i]=rig.FindBone("shin."+side);ankles[i]=rig.FindBone("foot."+side);
            arms[i]=rig.FindBone("upper_arm."+side);elbows[i]=rig.FindBone("forearm."+side);hands[i]=rig.FindBone("hand."+side);
            restFeet[i]=rig.GetBoneGlobalRest(ankles[i]);restHands[i]=rig.GetBoneGlobalRest(hands[i]);
        }
    }
    private Vector3 FootTarget(int side,out bool planted)
    {
        var target=restFeet[side].Origin;planted=true;
        bool moving=Actor.State is "walk" or "run" or "retreat" or "shield";
        if(!moving)return target;
        bool run=Actor.State is "run" or "retreat";
        float period=run?.72f:1.2f,stance=run?.48f:.64f;
        float phase=(float)(Actor.Animations.CurrentAnimationPosition/period+side*.5)%1;
        float stride=(run?(float)AntigoonBrain.RunSpeed:(float)AntigoonBrain.WalkSpeed)*period*stance;
        if(phase<stance)target.Z+=(.5f-phase/stance)*stride;
        else
        {
            float swing=(phase-stance)/(1-stance);float ease=swing*swing*(3-2*swing);
            target.Z+=(-.5f+ease)*stride;target.Y+=(run?.32f:.16f)*Mathf.Sin(Mathf.Pi*swing);planted=false;
        }
        return target;
    }
    public override void _PhysicsProcess(double delta)
    {
        if(!Actor.Visible||Actor.State=="death")return;
        var space=GetWorld3D().DirectSpaceState;
        var excluded=new Godot.Collections.Array<Rid>{Actor.BodyRid};
        for(int i=0;i<2;i++)
        {
            var target=FootTarget(i,out _);var world=rig.GlobalTransform*target;
            float Sample(float z)
            {
                var point=rig.GlobalTransform*(target+new Vector3(0,0,z));
                var ray=PhysicsRayQueryParameters3D.Create(new(point.X,Actor.GlobalPosition.Y+1.1f,point.Z),new(point.X,Actor.GlobalPosition.Y-1.2f,point.Z),1,excluded);
                var hit=space.IntersectRay(ray);
                return hit.Count>0?(rig.GlobalTransform.AffineInverse()*hit["position"].AsVector3()).Y:0;
            }
            float heel=Sample(-.12f),toe=Sample(.32f);floor[i]=(heel+toe)*.5f;slope[i]=Math.Clamp(Mathf.Atan2(toe-heel,.44f),-.4f,.4f);
        }
    }
    public override void _ProcessModificationWithDelta(double delta)=>ApplyPose(delta);
    public void ApplyPose(double delta)
    {
        if(rig==null||!Actor.Visible||Actor.State=="death")return;
        clock+=delta;
        bool moving=Actor.State is "walk" or "run" or "retreat" or "shield";
        if(moving)
        {
            var hipsPose=rig.GetBoneGlobalPose(pelvis);hipsPose.Origin-=Vector3.Up*(Actor.State is "run" or "retreat"?.22f:.14f);rig.SetBoneGlobalPose(pelvis,hipsPose);
        }
        // Let the pelvis settle when one boot is on a lower tread. IK must not stretch a straight leg.
        float settle=0;
        for(int i=0;i<2;i++)
        {
            if(Actor.State=="attack"&&i==1)continue;
            var hip=rig.GetBoneGlobalPose(hips[i]).Origin;var knee=rig.GetBoneGlobalPose(knees[i]).Origin;var ankle=rig.GetBoneGlobalPose(ankles[i]).Origin;
            var target=FootTarget(i,out _);target.Y+=floor[i];
            float reach=hip.DistanceTo(knee)+knee.DistanceTo(ankle)-.005f;
            float horizontal=new Vector2(target.X-hip.X,target.Z-hip.Z).LengthSquared();
            settle=Math.Max(settle,hip.Y-target.Y-Mathf.Sqrt(Math.Max(.01f,reach*reach-horizontal)));
        }
        if(settle>0){var hipsPose=rig.GetBoneGlobalPose(pelvis);hipsPose.Origin-=Vector3.Up*settle;rig.SetBoneGlobalPose(pelvis,hipsPose);}
        if(Actor.State!="shield")
        {
            float glance=(moving?.065f:.22f)*(float)(Math.Sin(clock*.61)*.75+Math.Sin(clock*1.23)*.25);
            rig.SetBonePoseRotation(head,rig.GetBonePoseRotation(head)*new Quaternion(Vector3.Up,glance));
            float breath=(float)Math.Sin(clock*2.05)*.006f;
            rig.SetBonePoseScale(chest,rig.GetBonePoseScale(chest)*new Vector3(1+breath,1+breath*.4f,1+breath));
        }
        for(int i=0;i<2;i++)
        {
            // The kicking leg keeps its attack arc; the support leg remains planted.
            if(Actor.State=="attack"&&i==1)continue;
            var target=FootTarget(i,out _);target.Y+=floor[i];
            var pole=rig.GetBoneGlobalPose(hips[i]).Origin+new Vector3(i==0?.1f:-.1f,-1,2);
            Limb(hips[i],knees[i],ankles[i],target,pole,new Basis(new Quaternion(Vector3.Right,-slope[i]))*restFeet[i].Basis);
        }
        if(Actor.State=="shield")
        {
            var face=rig.GetBoneGlobalPose(head).Origin+new Vector3(0,.14f,.4f);
            for(int i=0;i<2;i++)
            {
                float sign=i==0?1:-1;var target=face+new Vector3(sign*.075f,-.03f,0);
                var palm=new Basis(new Quaternion(Vector3.Right,Mathf.Pi))*restHands[i].Basis;
                Limb(arms[i],elbows[i],hands[i],target,face+new Vector3(sign*1,-.45f,.7f),palm);
            }
        }
    }
    private void Limb(int upper,int lower,int end,Vector3 target,Vector3 pole,Basis orientation)
    {
        var a=rig.GetBoneGlobalPose(upper);var b=rig.GetBoneGlobalPose(lower);var c=rig.GetBoneGlobalPose(end);
        float l1=a.Origin.DistanceTo(b.Origin),l2=b.Origin.DistanceTo(c.Origin);
        var axis=target-a.Origin;float distance=Math.Clamp(axis.Length(),Math.Abs(l1-l2)+.001f,l1+l2-.001f);axis=axis.Normalized();
        float along=(l1*l1-l2*l2+distance*distance)/(2*distance);
        var bend=pole-a.Origin;bend=(bend-axis*bend.Dot(axis)).Normalized();
        if(bend.LengthSquared()<.1f)bend=Vector3.Back;
        var joint=a.Origin+axis*along+bend*Mathf.Sqrt(Math.Max(0,l1*l1-along*along));
        var turn=new Quaternion((b.Origin-a.Origin).Normalized(),(joint-a.Origin).Normalized());
        rig.SetBoneGlobalPose(upper,new(new Basis(turn)*a.Basis,a.Origin));
        b=rig.GetBoneGlobalPose(lower);c=rig.GetBoneGlobalPose(end);
        turn=new Quaternion((c.Origin-b.Origin).Normalized(),(target-b.Origin).Normalized());
        rig.SetBoneGlobalPose(lower,new(new Basis(turn)*b.Basis,b.Origin));
        c=rig.GetBoneGlobalPose(end);rig.SetBoneGlobalPose(end,new(orientation,c.Origin));
    }
    public float PlantedFootError(int i)=>Math.Abs(rig.GetBoneGlobalPose(ankles[i]).Origin.Y-restFeet[i].Origin.Y-floor[i]);
    public bool IsPlanted(int i){FootTarget(i,out bool planted);return planted;}
    public string Diagnostics()=>$"rest {restFeet[0].Origin}, actual {rig.GetBoneGlobalPose(ankles[0]).Origin}, floor {floor[0]}, hip {rig.GetBoneGlobalPose(hips[0]).Origin}, knee {rig.GetBoneGlobalPose(knees[0]).Origin}";
}
