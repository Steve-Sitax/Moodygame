using Godot;
using System;

namespace Scheldemist.Native.Characters;

/// <summary>
/// Procedural body over the authored clips: world-locked footsteps (a boot stays where it landed until it lifts),
/// stepping turns, an upright walking posture, head-and-neck attention, shielding, and a planar kick.
/// </summary>
public partial class AntigoonPose : SkeletonModifier3D
{
    public AntigoonActor Actor=null!;
    /// <summary>World point he turns his head to (null: idle glances).</summary>
    public Vector3? LookAt;
    private Skeleton3D rig=null!;
    private readonly int[] hips=new int[2],knees=new int[2],ankles=new int[2],arms=new int[2],elbows=new int[2],hands=new int[2];
    private readonly Transform3D[] restFeet=new Transform3D[2],restHands=new Transform3D[2];
    private int head,neck,chest,spine,pelvis,jaw;
    private Quaternion jawOpen=Quaternion.Identity;
    private bool hasJaw;
    private double clock;
    private float lookYaw,lookPitch;
    private static float Smooth(double x){float t=Math.Clamp((float)x,0,1);return t*t*(3-2*t);}

    // One boot: where it stands in the world, or its swing from one hold to the next.
    private sealed class Boot
    {
        public Vector3 At;public float Yaw;public bool Swinging;
        public Vector3 From,To;public float FromYaw,ToYaw,T,Length;public double Landed;
    }
    private readonly Boot[] boots={new(),new()};
    private bool booted;
    private Vector3 lastBody,velocity;
    private string lastState="";
    private Func<Vector3,float?>? groundAt;

    public override void _Ready()
    {
        rig=GetSkeleton();head=rig.FindBone("head");neck=rig.FindBone("neck");chest=rig.FindBone("chest");spine=rig.FindBone("spine");pelvis=rig.FindBone("pelvis");
        for(int i=0;i<2;i++)
        {
            string side=i==0?"L":"R";
            hips[i]=rig.FindBone("thigh."+side);knees[i]=rig.FindBone("shin."+side);ankles[i]=rig.FindBone("foot."+side);
            arms[i]=rig.FindBone("upper_arm."+side);elbows[i]=rig.FindBone("forearm."+side);hands[i]=rig.FindBone("hand."+side);
            restFeet[i]=rig.GetBoneGlobalRest(ankles[i]);restHands[i]=rig.GetBoneGlobalRest(hands[i]);
        }
        // Borrow the open jaw from the authored roar clip for the kick's snarl.
        jaw=rig.FindBone("jaw");
        if(jaw>=0&&Actor.Animations.HasAnimation("roar"))
        {
            var roar=Actor.Animations.GetAnimation("roar");
            for(int t=0;t<roar.GetTrackCount();t++)
                if(roar.TrackGetType(t)==Animation.TrackType.Rotation3D&&roar.TrackGetPath(t).ToString().EndsWith(":jaw")){jawOpen=roar.RotationTrackInterpolate(t,.9);hasJaw=true;break;}
        }
    }
    /// <summary>Street height under a world point; default casts a ray past his own body.</summary>
    public Func<Vector3,float?> GroundAt { set=>groundAt=value; }
    private float Ground(Vector3 world)
    {
        if(groundAt!=null)return groundAt(world)??Actor.GlobalPosition.Y;
        var space=GetWorld3D()?.DirectSpaceState;if(space==null)return Actor.GlobalPosition.Y;
        var ray=PhysicsRayQueryParameters3D.Create(new(world.X,Actor.GlobalPosition.Y+1.2f,world.Z),new(world.X,Actor.GlobalPosition.Y-1.5f,world.Z),1,new Godot.Collections.Array<Rid>{Actor.BodyRid});
        var hit=space.IntersectRay(ray);return hit.Count>0?hit["position"].AsVector3().Y:Actor.GlobalPosition.Y;
    }
    private float BodyYaw=>Actor.GlobalRotation.Y;
    private Vector3 Home(int i)=>rig.GlobalTransform*restFeet[i].Origin;
    private float AnkleLift(int i)=>restFeet[i].Origin.Y;

    public override void _ProcessModificationWithDelta(double delta)=>ApplyPose(delta);
    public void ApplyPose(double delta)
    {
        if(rig==null||!Actor.Visible||Actor.State=="death")return;
        float dt=(float)Math.Clamp(delta,0,.1);clock+=dt;
        string state=Actor.State;
        var body=Actor.GlobalPosition;
        if(!booted){for(int i=0;i<2;i++)Plant(boots[i],Home(i),BodyYaw,i);lastBody=body;booted=true;}
        if(dt>0)velocity=velocity.Lerp(new Vector3(body.X-lastBody.X,0,body.Z-lastBody.Z)/dt,1-Mathf.Exp(-dt*10));
        if(body.DistanceTo(lastBody)>6){for(int i=0;i<2;i++)Plant(boots[i],Home(i),BodyYaw,i);velocity=Vector3.Zero;}
        lastBody=body;
        // The kicking boot comes down where the stomp left it; the stepping takes it home from there.
        if(lastState=="attack"&&state!="attack")Plant(boots[1],rig.GlobalTransform*rig.GetBoneGlobalPose(ankles[1]).Origin,BodyYaw,1);
        lastState=state;

        bool kicking=state=="attack";
        float speed=velocity.Length();
        Posture(state,speed);
        if(kicking)KickBody(Actor.Animations.CurrentAnimationPosition);
        // Mid-kick he stands on his left boot: a swing already under way finishes, no new step starts.
        Step(dt,speed,start:!kicking);
        // Lower the pelvis only as far as the boots need to reach their holds: a straight leg never stretches.
        float settle=state is "walk" or "run" or "retreat" or "shield"?Math.Min(.06f,speed*.012f):0;
        for(int i=0;i<2;i++)
        {
            if(kicking&&i==1)continue;
            var hip=rig.GetBoneGlobalPose(hips[i]).Origin;var knee=rig.GetBoneGlobalPose(knees[i]).Origin;var ankle=rig.GetBoneGlobalPose(ankles[i]).Origin;
            var target=rig.GlobalTransform.AffineInverse()*BootPoint(i);
            float reach=hip.DistanceTo(knee)+knee.DistanceTo(ankle)-.01f;
            float horizontal=new Vector2(target.X-hip.X,target.Z-hip.Z).LengthSquared();
            settle=Math.Max(settle,hip.Y-target.Y-Mathf.Sqrt(Math.Max(.01f,reach*reach-horizontal)));
        }
        if(settle>0){var hipsPose=rig.GetBoneGlobalPose(pelvis);hipsPose.Origin-=Vector3.Up*settle;rig.SetBoneGlobalPose(pelvis,hipsPose);}
        Attend(dt,state);
        for(int i=0;i<2;i++)
        {
            if(kicking&&i==1){KickLeg(Actor.Animations.CurrentAnimationPosition);continue;}
            var target=rig.GlobalTransform.AffineInverse()*BootPoint(i);
            var pole=rig.GetBoneGlobalPose(hips[i]).Origin+new Vector3(i==0?.12f:-.12f,-1,2.2f);
            var turn=new Basis(Vector3.Up,BootYaw(i)-BodyYaw);
            Limb(hips[i],knees[i],ankles[i],target,pole,turn*new Basis(Vector3.Right,BootPitch(i))*restFeet[i].Basis);
        }
        if(state=="shield")
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

    // ---- footsteps

    private void Plant(Boot b,Vector3 at,float yaw,int i)
    {
        b.Swinging=false;b.At=new(at.X,Ground(at)+AnkleLift(i),at.Z);b.Yaw=yaw;b.Landed=clock;
    }
    private Vector3 BootPoint(int i)
    {
        var b=boots[i];if(!b.Swinging)return b.At;
        float e=Smooth(b.T);var p=b.From.Lerp(b.To,e);
        p.Y+=Mathf.Sin(Mathf.Pi*b.T)*Math.Clamp(.1f+b.Length*.2f,.1f,.6f);
        // A long stride folds the heel up behind before the knee drives it forward.
        if(b.Length>1.6f){var back=(b.From-b.To);back.Y=0;float curl=Mathf.Sin(Mathf.Pi*Math.Min(1,b.T*1.6f))*(1-b.T);p+=back.Normalized()*curl*.5f+Vector3.Up*curl*.55f;}
        return p;
    }
    private float BootYaw(int i){var b=boots[i];return b.Swinging?Mathf.LerpAngle(b.FromYaw,b.ToYaw,Smooth(b.T)):b.Yaw;}
    // Toe-off before the lift, heel strike before the plant.
    private float BootPitch(int i){var b=boots[i];return b.Swinging?.35f*Mathf.Sin(Mathf.Pi*b.T*1.2f)-.15f*Smooth((b.T-.8)/.2):0;}
    private void Step(float dt,float speed,bool start=true)
    {
        float swing=Math.Clamp(.62f-speed*.068f,.3f,.55f);
        for(int i=0;i<2;i++)
        {
            var b=boots[i];if(!b.Swinging)continue;
            b.T+=dt/swing;if(b.T>=1){Plant(b,b.To,b.ToYaw,i);}
        }
        if(!start||boots[0].Swinging||boots[1].Swinging)return;
        // A walking boot lifts once the body has passed it by part of a stride; it lands as far ahead again, so each
        // boot stands about 1.3 swings and both stand together between steps. A still giant squares his feet after
        // a pause, and any boot left facing the old way when he turns steps round.
        var heading=speed>.2f?velocity/speed:Vector3.Zero;
        // Running, each boot stands only as long as the other is in the air.
        float stand=speed>3?.5f:.65f;
        int pick=-1;float worst=0;
        for(int i=0;i<2;i++)
        {
            var b=boots[i];if(clock-b.Landed<.08)continue;
            var d=Home(i)-b.At;d.Y=0;
            float turn=Math.Abs(Mathf.AngleDifference(b.Yaw,BodyYaw)),score;bool due;
            if(speed>.2f)
            {
                float lag=d.Dot(heading),side=(d-heading*lag).Length(),need=speed*swing*stand;
                due=lag>need||side>.3f||turn>.42f;score=lag/need+side/.3f+turn/.42f;
            }
            else
            {
                float off=d.Length(),need=clock-b.Landed>.6?.1f:.32f;
                due=off>need||turn>.42f;score=off/need+turn/.42f;
            }
            if(due&&score>worst){worst=score;pick=i;}
        }
        if(pick<0)return;
        var boot=boots[pick];
        var to=Home(pick)+velocity*swing*(1+stand);
        boot.Swinging=true;boot.T=0;boot.From=boot.At;boot.FromYaw=boot.Yaw;boot.ToYaw=BodyYaw;
        boot.To=new(to.X,Ground(to)+AnkleLift(pick),to.Z);boot.Length=new Vector2(boot.To.X-boot.From.X,boot.To.Z-boot.From.Z).Length();
    }

    // ---- posture and attention

    private void Posture(string state,float speed)
    {
        // Measure the trunk (pelvis to neck) after the clip and set it upright, leaning into a stride as he speeds up.
        if(spine<0||neck<0)return;
        var p=rig.GetBoneGlobalPose(pelvis).Origin;var n=rig.GetBoneGlobalPose(neck).Origin;
        float lean=Mathf.Atan2(n.Z-p.Z,n.Y-p.Y);
        float want=state switch{"shield"=>.12f,"notice"=>.1f,_=>.03f+Math.Min(.26f,speed*.052f)};
        Turn(spine,Vector3.Right,want-lean);
    }
    private void Attend(float dt,string state)
    {
        if(head<0)return;
        float yaw=0,pitch=0;
        if(LookAt is {} target&&state is not ("shield" or "attack"))
        {
            // Eyes on the prey within the neck's turn; past it he turns his whole body by stepping (the actor turns him).
            var local=rig.GlobalTransform.AffineInverse()*target-rig.GetBoneGlobalPose(head).Origin;
            yaw=Math.Clamp(Mathf.Atan2(local.X,local.Z),-1.15f,1.15f);
            pitch=Math.Clamp(-Mathf.Atan2(local.Y,new Vector2(local.X,local.Z).Length()),-.35f,.6f);
        }
        else if(state is not ("shield" or "attack"))yaw=.2f*(float)(Math.Sin(clock*.61)*.75+Math.Sin(clock*1.23)*.25);
        float s=1-Mathf.Exp(-dt*5);lookYaw+=(yaw-lookYaw)*s;lookPitch+=(pitch-lookPitch)*s;
        if(neck>=0)Turn(neck,Vector3.Up,lookYaw*.4f);
        Turn(head,Vector3.Up,lookYaw*.6f);
        Turn(head,new Basis(Vector3.Up,lookYaw).X,lookPitch*.7f);
        if(state is not ("shield" or "attack"))
        {
            float breath=(float)Math.Sin(clock*2.05)*.006f;
            rig.SetBonePoseScale(chest,rig.GetBonePoseScale(chest)*new Vector3(1+breath,1+breath*.4f,1+breath));
        }
    }

    // ---- the kick: a straight swing in his own side plane, so the knee only ever folds the way a knee folds

    // (hip, knee, ankle) angles about his side axis: hip < 0 lifts the thigh ahead, knee > 0 folds the shin back, ankle > 0 points the toe.
    private static readonly (double T,float Hip,float Knee,float Ankle)[] Kick=
    {
        (0,0,0,0),(.34,.55f,1.55f,.3f),(.62,-1.05f,.3f,.5f),(.80,-1.4f,.2f,.35f),(1.10,-.38f,.36f,.02f),(1.35,-.38f,.36f,.02f),
    };
    private static (float Hip,float Knee,float Ankle) KickAngles(double t)
    {
        for(int k=1;k<Kick.Length;k++)
        {
            if(t>Kick[k].T&&k<Kick.Length-1)continue;
            var a=Kick[k-1];var b=Kick[k];float u=Math.Clamp((float)((t-a.T)/(b.T-a.T)),0,1);
            // The swing to contact accelerates; every other leg of the move eases in and out.
            float e=k==2?u*u:k==3?1-(1-u)*(1-u):Smooth(u);
            return (Mathf.Lerp(a.Hip,b.Hip,e),Mathf.Lerp(a.Knee,b.Knee,e),Mathf.Lerp(a.Ankle,b.Ankle,e));
        }
        return (0,0,0);
    }
    private void KickLeg(double t)
    {
        var (hip,knee,ankle)=KickAngles(t);
        foreach(int bone in new[]{hips[1],knees[1],ankles[1]})rig.SetBonePoseRotation(bone,rig.GetBoneRest(bone).Basis.GetRotationQuaternion());
        // His side axis as the hips face now (they twist into the kick), so thigh, shin and boot stay in one plane.
        var side=rig.GetBoneGlobalPose(pelvis).Basis.X;
        Turn(hips[1],side,hip);Turn(knees[1],side,knee);Turn(ankles[1],side,ankle);
    }
    private void KickBody(double t)
    {
        float wind=Smooth(t/.34),strike=Smooth((t-.34)/.28),stomp=Smooth((t-.8)/.3);
        var hipsPose=rig.GetBoneGlobalPose(pelvis);
        hipsPose.Origin+=new Vector3(0,-.1f*wind*(1-stomp),.22f*strike);
        hipsPose.Basis=new Basis(Vector3.Up,-.18f*wind*(1-strike)+.22f*strike*(1-stomp))*hipsPose.Basis;
        rig.SetBoneGlobalPose(pelvis,hipsPose);
        // Coil forward over the wind-up, set the shoulders back against the swing, then come forward over the stomp.
        Turn(spine,Vector3.Right,.16f*wind*(1-strike)-.14f*strike*(1-stomp)+.1f*stomp);
        Turn(head,Vector3.Right,.2f*wind);
        if(hasJaw)rig.SetBonePoseRotation(jaw,rig.GetBonePoseRotation(jaw).Slerp(jawOpen,wind*(1-stomp)));
        for(int i=0;i<2;i++)
        {
            // The arm opposite the kicking leg swings through with it; the other goes out and back for balance.
            float side=Math.Sign(restHands[i].Origin.X);var shoulder=rig.GetBoneGlobalPose(arms[i]).Origin;var hand=rig.GetBoneGlobalPose(hands[i]);
            var back=shoulder+(i==0?new Vector3(side*.45f,-1.05f,-.5f):new Vector3(side*.6f,-1.0f,.35f));
            var through=shoulder+(i==0?new Vector3(side*.35f,-.55f,.95f):new Vector3(side*.85f,-.75f,-.4f));
            var target=hand.Origin.Lerp(back,wind).Lerp(through,strike).Lerp(hand.Origin,stomp);
            Limb(arms[i],elbows[i],hands[i],target,shoulder+new Vector3(side*.8f,-.3f,-.8f),hand.Basis);
        }
    }

    private void Turn(int bone,Vector3 axis,float angle)
    {
        if(bone<0||Math.Abs(angle)<1e-5f)return;var g=rig.GetBoneGlobalPose(bone);rig.SetBoneGlobalPose(bone,new(new Basis(axis.Normalized(),angle)*g.Basis,g.Origin));
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

    // ---- proof aids

    /// <summary>World ankle position of a boot and whether it is standing (not swinging).</summary>
    public (Vector3 At,bool Planted) Boots(int i)=>(BootPoint(i),!boots[i].Swinging);
    /// <summary>How far the posed ankle is from its boot's hold (IK error, metres).</summary>
    public float BootError(int i)=>(rig.GlobalTransform*rig.GetBoneGlobalPose(ankles[i]).Origin).DistanceTo(BootPoint(i));
    /// <summary>Trunk lean after posing: radians forward of vertical, pelvis to neck.</summary>
    public float Lean(){var p=rig.GetBoneGlobalPose(pelvis).Origin;var n=rig.GetBoneGlobalPose(neck).Origin;return Mathf.Atan2(n.Z-p.Z,n.Y-p.Y);}
    /// <summary>Knee fold of the kicking leg: the shin's angle behind the thigh line, radians (never negative).</summary>
    public float KickKnee(){var h=rig.GetBoneGlobalPose(hips[1]).Origin;var k=rig.GetBoneGlobalPose(knees[1]).Origin;var a=rig.GetBoneGlobalPose(ankles[1]).Origin;
        var thigh=(k-h).Normalized();var shin=(a-k).Normalized();float fold=thigh.AngleTo(shin);return thigh.Cross(shin).X<-.02f?-fold:fold;}
}
