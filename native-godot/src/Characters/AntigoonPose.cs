using Godot;
using System;
using System.Collections.Generic;
using System.Linq;

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
    /// <summary>His right fist: where it reaches (world), how much (0..1), and whether the hand is closed on a neck.</summary>
    public (Vector3 Target,float Weight,bool Closed)? Grip;
    public event Action<int>? Landed;
    /// <summary>His right fist after the full pose (the bone's own pose omits this modifier's work).</summary>
    public Vector3 FistWorld { get; private set; }
    private Skeleton3D rig=null!;
    private readonly int[] hips=new int[2],knees=new int[2],ankles=new int[2],arms=new int[2],elbows=new int[2],hands=new int[2];
    private readonly Transform3D[] restFeet=new Transform3D[2],restHands=new Transform3D[2];
    private int head,neck,chest,spine,pelvis,jaw;
    private int[] fingersR=Array.Empty<int>();
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
    private bool booted,leaping;
    private float lastGround;
    private Vector3 lastBody,velocity;
    private string lastState="";
    private Func<Vector3,float?>? groundAt;
    // Dead blending (after D. Holden's description): on a clip change the last pose keeps its motion, slowing
    // with a short half-life, and fades into the new clip. Only the current pose and its speed are needed.
    public const float BlendTime=.28f,BlendHalfLife=.07f;
    private Quaternion[] lastPose=Array.Empty<Quaternion>(),heldPose=Array.Empty<Quaternion>();
    private Vector3[] spin=Array.Empty<Vector3>();
    private string lastClip="";
    private float blend=BlendTime;

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
        fingersR=Enumerable.Range(0,rig.GetBoneCount()).Where(b=>rig.GetBoneName(b).StartsWith("finger")&&rig.GetBoneName(b).EndsWith(".R")).ToArray();
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
    /// <summary>Where his boots point, on average (a swinging boot counts where it will land).</summary>
    public float FeetYaw{get{float a=boots[0].Swinging?boots[0].ToYaw:boots[0].Yaw,b=boots[1].Swinging?boots[1].ToYaw:boots[1].Yaw;return a+Mathf.AngleDifference(a,b)*.5f;}}
    private Vector3 Home(int i)=>rig.GlobalTransform*restFeet[i].Origin;
    private float AnkleLift(int i)=>restFeet[i].Origin.Y;

    public override void _ProcessModificationWithDelta(double delta)=>ApplyPose(delta);
    public void ApplyPose(double delta)
    {
        if(rig==null||!Actor.Visible||Actor.State=="death")return;
        float dt=(float)Math.Clamp(delta,0,.1);clock+=dt;
        DeadBlend(dt);
        string state=Actor.State;
        var body=Actor.GlobalPosition;
        if(!booted){for(int i=0;i<2;i++)Plant(boots[i],Home(i),BodyYaw,i);lastBody=body;booted=true;}
        if(dt>0)velocity=velocity.Lerp(new Vector3(body.X-lastBody.X,0,body.Z-lastBody.Z)/dt,1-Mathf.Exp(-dt*10));
        if(body.DistanceTo(lastBody)>6){for(int i=0;i<2;i++){Plant(boots[i],Home(i),BodyYaw,i);held[i]=false;holdWeight[i]=0;}velocity=Vector3.Zero;}
        lastBody=body;
        // The kicking boot comes down where the stomp left it; the stepping takes it home from there.
        if(lastState=="attack"&&state!="attack")Plant(boots[1],rig.GlobalTransform*rig.GetBoneGlobalPose(ankles[1]).Origin,BodyYaw,1);
        lastState=state;

        bool kicking=state=="attack";
        float speed=velocity.Length();
        // Walking and running are the library's own legs: its clip plays at the stride that matches his speed, and a
        // foot is only held to the street while the clip has it down. Standing, turning and the rest are stepped here.
        string clip=Actor.Animations.CurrentAnimation;
        bool striding=state is "walk" or "run" or "retreat" or "shield"&&clip.StartsWith("ual/")&&GaitOf(clip) is not null;
        if(striding!=wasStriding)
        {
            if(!striding)for(int i=0;i<2;i++)Plant(boots[i],rig.GlobalTransform*rig.GetBoneGlobalPose(ankles[i]).Origin,BodyYaw,i);
            else for(int i=0;i<2;i++){held[i]=false;holdWeight[i]=0;}
            wasStriding=striding;
        }
        if(!striding&&state is not ("death" or "hit" or "recoil_light"))
        {
            // The library's hip travel is a man's, scaled to a giant: standing, keep a third of its bounce, half its sway.
            var hipsPose=rig.GetBoneGlobalPose(pelvis);var rest=rig.GetBoneGlobalRest(pelvis).Origin;var off=hipsPose.Origin-rest;
            hipsPose.Origin=rest+new Vector3(off.X*.5f,off.Y*.35f,off.Z*.5f);rig.SetBoneGlobalPose(pelvis,hipsPose);
        }
        if(striding)Upright();else Posture(state,speed);
        Stoop();
        if(kicking)KickBody(Actor.Animations.CurrentAnimationPosition);
        // Mid-kick he stands on his left boot: a swing already under way finishes, no new step starts.
        // In a leap both boots leave the street and travel tucked under him; both land together.
        if(state!="jump")lastGround=Actor.GlobalPosition.Y;
        if(striding)Stride(dt,speed,clip);
        else if(state=="jump"){for(int i=0;i<2;i++){var b=boots[i];b.Swinging=false;b.At=Home(i)+Vector3.Up*(.25f+.45f*Mathf.Clamp(Actor.GlobalPosition.Y-lastGround,0,1));b.Yaw=BodyYaw;}leaping=true;}
        else
        {
            if(leaping){leaping=false;for(int i=0;i<2;i++){Plant(boots[i],Home(i),BodyYaw,i);Landed?.Invoke(i);}}
            Step(dt,speed,start:!kicking);
        }
        // Lower the pelvis only as far as the boots need to reach their holds: a straight leg never stretches.
        float settle=state is "walk" or "run" or "retreat" or "shield"?Math.Min(.06f,speed*.012f):0;
        for(int i=0;i<2;i++)
        {
            if(kicking&&i==1)continue;
            var hip=rig.GetBoneGlobalPose(hips[i]).Origin;var knee=rig.GetBoneGlobalPose(knees[i]).Origin;var ankle=rig.GetBoneGlobalPose(ankles[i]).Origin;
            var target=rig.GlobalTransform.AffineInverse()*(striding?strideTarget[i]:BootPoint(i));
            float reach=hip.DistanceTo(knee)+knee.DistanceTo(ankle)-.01f;
            float horizontal=new Vector2(target.X-hip.X,target.Z-hip.Z).LengthSquared();
            settle=Math.Max(settle,hip.Y-target.Y-Mathf.Sqrt(Math.Max(.01f,reach*reach-horizontal)));
        }
        LastSettle=settle;settle=Math.Min(settle,.7f);
        if(settle>0){var hipsPose=rig.GetBoneGlobalPose(pelvis);hipsPose.Origin-=Vector3.Up*settle;rig.SetBoneGlobalPose(pelvis,hipsPose);}
        Attend(dt,state);
        for(int i=0;i<2;i++)
        {
            if(kicking&&i==1){KickLeg(Actor.Animations.CurrentAnimationPosition);continue;}
            if(striding)
            {
                // Keep the clip's own knee line and foot angle; only the ankle is moved onto its hold or the street.
                var hip=rig.GetBoneGlobalPose(hips[i]).Origin;var knee=rig.GetBoneGlobalPose(knees[i]).Origin;var foot=rig.GetBoneGlobalPose(ankles[i]);
                var bend=knee-(hip+foot.Origin)*.5f;
                Limb(hips[i],knees[i],ankles[i],rig.GlobalTransform.AffineInverse()*strideTarget[i],knee+bend*2+new Vector3(0,0,.05f),foot.Basis);
                continue;
            }
            var target=rig.GlobalTransform.AffineInverse()*BootPoint(i);
            var pole=rig.GetBoneGlobalPose(hips[i]).Origin+new Vector3(i==0?.12f:-.12f,-1,2.2f);
            var turn=new Basis(Vector3.Up,BootYaw(i)-BodyYaw);
            Limb(hips[i],knees[i],ankles[i],target,pole,turn*new Basis(Vector3.Right,BootPitch(i))*restFeet[i].Basis);
        }
        if(Grip is {} grip&&grip.Weight>0)
        {
            // The right arm reaches for the neck, then holds it out before his face.
            var hand=rig.GetBoneGlobalPose(hands[1]);var shoulder=rig.GetBoneGlobalPose(arms[1]).Origin;
            var want=rig.GlobalTransform.AffineInverse()*grip.Target;
            var target=hand.Origin.Lerp(want,Smooth(grip.Weight));
            Limb(arms[1],elbows[1],hands[1],target,shoulder+new Vector3(-.9f,-.6f,-.5f),hand.Basis);
            if(grip.Closed)foreach(int finger in fingersR)rig.SetBonePoseRotation(finger,rig.GetBonePoseRotation(finger)*new Quaternion(Vector3.Right,1.1f));
        }
        FistWorld=rig.GlobalTransform*rig.GetBoneGlobalPose(hands[1]).Origin;
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

    private void DeadBlend(float dt)
    {
        int n=rig.GetBoneCount();
        if(lastPose.Length!=n){lastPose=new Quaternion[n];heldPose=new Quaternion[n];spin=new Vector3[n];for(int b=0;b<n;b++)lastPose[b]=heldPose[b]=rig.GetBonePoseRotation(b).Normalized();}
        string clip=Actor.Animations.CurrentAnimation;
        if(clip!=lastClip&&lastClip!=""){blend=0;for(int b=0;b<n;b++)heldPose[b]=lastPose[b];}
        lastClip=clip;
        for(int b=0;b<n;b++)
        {
            // Clip keys and earlier layers leave tiny drift; slerp needs unit quaternions.
            var now=rig.GetBonePoseRotation(b).Normalized();
            if(blend<BlendTime)
            {
                // Carry the held pose on along its spin, the spin dying away, then ease from it into the clip.
                if(spin[b].LengthSquared()>1e-10f)heldPose[b]=(new Quaternion(spin[b].Normalized(),spin[b].Length()*dt)*heldPose[b]).Normalized();
                spin[b]*=Mathf.Exp(-.6931472f*dt/BlendHalfLife);
                now=heldPose[b].Normalized().Slerp(now,Smooth(blend/BlendTime)).Normalized();rig.SetBonePoseRotation(b,now);
            }
            else if(dt>0)
            {
                // Remember each bone's spin (axis times rad/s) for the next change.
                var turn=(now*lastPose[b].Inverse()).Normalized();if(turn.W<0)turn=-turn;
                float angle=2*Mathf.Acos(Math.Clamp(turn.W,-1,1));var axis=new Vector3(turn.X,turn.Y,turn.Z);
                spin[b]=axis.LengthSquared()>1e-12f?axis.Normalized()*angle/dt:Vector3.Zero;
            }
            lastPose[b]=now;
        }
        blend+=dt;
    }

    /// <summary>To reach a man's neck far below his shoulder he squats and bends forward; the boots stay planted.</summary>
    private void Stoop()
    {
        if(Grip is not {} grip||grip.Weight<=0)return;
        float shoulder=(rig.GlobalTransform*rig.GetBoneGlobalPose(arms[1]).Origin).Y;
        float s=Smooth((shoulder-grip.Target.Y-1.1f)/1.7f)*Smooth(grip.Weight);if(s<=0)return;
        var hipsPose=rig.GetBoneGlobalPose(pelvis);hipsPose.Origin+=new Vector3(0,-.9f*s,-.25f*s);rig.SetBoneGlobalPose(pelvis,hipsPose);
        Turn(spine,Vector3.Right,.8f*s);Turn(neck,Vector3.Right,-.35f*s);
    }

    // ---- the library's stride

    private sealed class Gait{public float Speed;public bool[][] Down=new bool[2][];public int Samples;}
    private readonly Dictionary<string,Gait?> gaits=new();
    private readonly bool[] held=new bool[2];
    private readonly float[] holdWeight=new float[2];
    private readonly Vector3[] holdAt=new Vector3[2],strideTarget=new Vector3[2];
    private bool wasStriding;
    /// <summary>
    /// Read a walk or run clip once: when each foot is down (lowest part of its arc and travelling back) and the
    /// speed it is meant for (how fast a planted foot slides back under the body in the clip).
    /// </summary>
    private Gait? GaitOf(string clip)
    {
        if(gaits.TryGetValue(clip,out var known))return known;
        var a=Actor.Animations.GetAnimation(clip);Gait? gait=null;
        if(a!=null&&a.LoopMode==Animation.LoopModeEnum.Linear&&a.Length>.2f)
        {
            const int n=60;gait=new Gait{Samples=n};var speeds=new List<float>();
            for(int i=0;i<2;i++)
            {
                var y=new float[n];var z=new float[n];
                for(int k=0;k<n;k++){var p=ClipBone(a,ankles[i],a.Length*k/n);y[k]=p.Y;z[k]=p.Z;}
                float low=y.Min(),high=y.Max();var down=new bool[n];
                for(int k=0;k<n;k++)
                {
                    float back=z[(k+1)%n]-z[(k+n-1)%n];
                    down[k]=y[k]<low+Math.Max(.06f,(high-low)*.2f)&&back<0;
                }
                // The foot's own backward pace while down, step by step; the loop seam is left out.
                for(int k=0;k+1<n;k++)if(down[k]&&down[k+1])speeds.Add((float)(-(z[k+1]-z[k])/(a.Length/n)));
                gait.Down[i]=down;
            }
            speeds.Sort();gait.Speed=speeds.Count>0?Math.Max(.2f,speeds[speeds.Count/2]):1;
        }
        gaits[clip]=gait;return gait;
    }
    /// <summary>A bone's skeleton-space position in a clip at time `t`, from the clip's own tracks over the rest pose.</summary>
    private Vector3 ClipBone(Animation a,int bone,double t)
    {
        var chain=new List<int>();for(int b=bone;b>=0;b=rig.GetBoneParent(b))chain.Add(b);chain.Reverse();
        var global=Transform3D.Identity;
        foreach(int b in chain)
        {
            var rest=rig.GetBoneRest(b);var origin=rest.Origin;var turn=rest.Basis.GetRotationQuaternion();string name=":"+rig.GetBoneName(b);
            for(int k=0;k<a.GetTrackCount();k++)
            {
                if(!a.TrackGetPath(k).ToString().EndsWith(name))continue;
                if(a.TrackGetType(k)==Animation.TrackType.Rotation3D)turn=a.RotationTrackInterpolate(k,t);
                else if(a.TrackGetType(k)==Animation.TrackType.Position3D)origin=a.PositionTrackInterpolate(k,t);
            }
            global=global*new Transform3D(new Basis(turn.Normalized()),origin);
        }
        return global.Origin;
    }
    private void Stride(float dt,float speed,string clip)
    {
        var gait=GaitOf(clip)!;
        // Play the stride at the pace that matches his ground speed, so a planted foot keeps still in the street.
        // Eased: a pace that jumps with every position update makes the stride stutter.
        float pace=Math.Clamp(speed/Math.Max(.1f,gait.Speed),.35f,2.2f);
        Actor.Animations.SpeedScale=Mathf.Lerp(Actor.Animations.SpeedScale,pace,1-Mathf.Exp(-dt*4));
        var a=Actor.Animations.GetAnimation(clip);int at=(int)(Actor.Animations.CurrentAnimationPosition/a.Length*gait.Samples)%gait.Samples;
        for(int i=0;i<2;i++)
        {
            var animated=rig.GlobalTransform*rig.GetBoneGlobalPose(ankles[i]).Origin;
            // The street under the foot replaces the clip's flat floor.
            float floorY=Ground(animated);var target=animated+Vector3.Up*(floorY-Actor.GlobalPosition.Y);
            bool down=gait.Down[i][at];
            if(down&&!held[i]){held[i]=true;holdAt[i]=new(target.X,floorY+AnkleLift(i),target.Z);Landed?.Invoke(i);}
            if(!down)held[i]=false;
            holdWeight[i]=Mathf.MoveToward(holdWeight[i],held[i]?1:0,dt/.08f);
            if(held[i])holdAt[i].Y=floorY+AnkleLift(i);
            strideTarget[i]=target.Lerp(holdAt[i],holdWeight[i]);
        }
    }
    /// <summary>Proof aid: the stride a clip is read as: its ground speed and how many samples each foot is down.</summary>
    public string GaitReport(string clip)=>GaitOf(clip) is {} g?$"{clip}: {g.Speed:0.00} m/s, left down {g.Down[0].Count(d=>d)}/{g.Samples}, right down {g.Down[1].Count(d=>d)}/{g.Samples}":clip+": not a stride";
    /// <summary>The library walk is upright; only never let the trunk fall behind the hips.</summary>
    private void Upright()
    {
        // Hurrying, he leans into it.
        if(spine<0||neck<0)return;float want=Actor.State is "run" or "retreat"?.12f:.03f,lean=Lean();if(lean<want)Turn(spine,Vector3.Right,want-lean);
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
        float swing=Math.Clamp(.62f-speed*.072f,.27f,.55f);
        for(int i=0;i<2;i++)
        {
            var b=boots[i];if(!b.Swinging)continue;
            b.T+=dt/swing;if(b.T>=1){Plant(b,b.To,b.ToYaw,i);Landed?.Invoke(i);}
        }
        // A boot left beyond any stride (a jump in the host's position) is set back under him.
        for(int i=0;i<2;i++)if(!boots[i].Swinging&&new Vector2(Home(i).X-boots[i].At.X,Home(i).Z-boots[i].At.Z).Length()>2.4f)Plant(boots[i],Home(i),BodyYaw,i);
        // Running has a flight: the next boot may lift once the other is past the top of its swing.
        bool Busy(Boot b)=>b.Swinging&&!(speed>3&&b.T>.5f);
        if(!start||Busy(boots[0])||Busy(boots[1]))return;
        // A walking boot lifts once the body has passed it by part of a stride; it lands as far ahead again, so each
        // boot stands about 1.3 swings and both stand together between steps. A still giant squares his feet after
        // a pause, and any boot left facing the old way when he turns steps round.
        var heading=speed>.2f?velocity/speed:Vector3.Zero;
        // Balance first: where his weight is heading (the capture point) must stay over his boots, or a boot must
        // go and catch it, as anyone would step rather than fall.
        var (icp,tip)=Balance();
        // Running, each boot stands only as long as the other is in the air.
        float stand=speed>3?.42f:.65f;
        int pick=-1;float worst=0;
        for(int i=0;i<2;i++)
        {
            var b=boots[i];if(b.Swinging||clock-b.Landed<.08)continue;
            var d=Home(i)-b.At;d.Y=0;
            // Turning on the spot he steps early, so the hips never twist far over a planted boot.
            float turn=Math.Abs(Mathf.AngleDifference(b.Yaw,BodyYaw)),score;bool due;
            if(speed>.2f)
            {
                float lag=d.Dot(heading),side=(d-heading*lag).Length(),need=speed*swing*stand;
                due=lag>need||side>.3f||turn>.42f;score=lag/need+side/.3f+turn/.42f;
            }
            else
            {
                float off=d.Length(),need=clock-b.Landed>.6?.1f:.32f;
                due=off>need||turn>.18f;score=off/need+turn/.18f;
            }
            if(due&&score>worst){worst=score;pick=i;}
        }
        // Running is falling forward caught by each stride: there the gait itself does the catching.
        if(tip>0&&speed<2.5f)
        {
            // Out of balance: the boot furthest from where the weight goes steps to catch it.
            int far=-1;float farthest=-1;
            for(int i=0;i<2;i++){var b=boots[i];if(b.Swinging||clock-b.Landed<.05)continue;float d=new Vector2(b.At.X-icp.X,b.At.Z-icp.Z).Length();if(d>farthest){farthest=d;far=i;}}
            if(far>=0)pick=far;
        }
        if(pick<0)return;
        var boot=boots[pick];
        // A turning step lands already turned part of the way on toward where he means to face.
        float ahead=Math.Clamp(Mathf.AngleDifference(BodyYaw,Actor.Facing),-AntigoonActor.TwistLimit,AntigoonActor.TwistLimit);
        var hold=rig.GlobalTransform.Origin;var spot=Home(pick)-hold;spot=new Basis(Vector3.Up,ahead)*spot;
        var to=hold+spot+velocity*swing*(1+stand);
        // Land where the weight will be: the boot's own side of the capture point, where it is heading by then.
        var flank=Home(pick)-hold;flank=flank-BodyBasisZ*flank.Dot(BodyBasisZ);flank.Y=0;
        var catchAt=icp+velocity*swing+flank;catchAt.Y=to.Y;
        to=to.Lerp(catchAt,speed>=2.5f?.15f:tip>0?.8f:.35f);
        var reachFrom=Home(pick);var stride=new Vector2(to.X-reachFrom.X,to.Z-reachFrom.Z);
        if(stride.Length()>1.9f){stride=stride.Normalized()*1.9f;to=new(reachFrom.X+stride.X,to.Y,reachFrom.Z+stride.Y);}
        boot.Swinging=true;boot.T=0;boot.From=boot.At;boot.FromYaw=boot.Yaw;boot.ToYaw=BodyYaw+ahead;
        boot.To=new(to.X,Ground(to)+AnkleLift(pick),to.Z);boot.Length=new Vector2(boot.To.X-boot.From.X,boot.To.Z-boot.From.Z).Length();
    }

    private Vector3 BodyBasisZ=>Actor.GlobalBasis.Z;
    /// <summary>
    /// His capture point (centre of mass carried on by its speed, linear inverted pendulum: x + v / sqrt(g / h)) and
    /// how far it lies outside the ground his planted boots cover (negative: safely inside).
    /// </summary>
    public (Vector3 Capture,float Outside) Balance()
    {
        var hips=rig.GlobalTransform*rig.GetBoneGlobalPose(pelvis).Origin;var trunk=rig.GlobalTransform*rig.GetBoneGlobalPose(chest).Origin;
        var mass=hips.Lerp(trunk,.35f);float height=Math.Max(.5f,mass.Y-Actor.GlobalPosition.Y);
        var capture=mass+velocity/Mathf.Sqrt(9.8f/height);capture.Y=Actor.GlobalPosition.Y;
        const float Sole=.4f;
        var planted=boots.Where(b=>!b.Swinging).Select(b=>b.At).ToArray();
        if(planted.Length==0)return (capture,0);
        float d;
        if(planted.Length==1)d=new Vector2(capture.X-planted[0].X,capture.Z-planted[0].Z).Length();
        else
        {
            var a=new Vector2(planted[0].X,planted[0].Z);var b=new Vector2(planted[1].X,planted[1].Z);var c=new Vector2(capture.X,capture.Z);
            var ab=b-a;float t=ab.LengthSquared()<1e-6f?0:Math.Clamp((c-a).Dot(ab)/ab.LengthSquared(),0,1);d=c.DistanceTo(a+ab*t);
        }
        return (capture,d-Sole);
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
        // His weight goes over the standing boot before the other leaves the ground.
        float support=Math.Sign(restFeet[0].Origin.X)*.32f*Smooth(t/.2)*(1-stomp);
        hipsPose.Origin+=new Vector3(support,-.1f*wind*(1-stomp),.22f*strike);
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
    public (Vector3 At,bool Planted) Boots(int i)=>wasStriding?(held[i]?holdAt[i]:strideTarget[i],held[i]):(BootPoint(i),!boots[i].Swinging);
    /// <summary>How far the posed ankle is from its boot's hold (IK error, metres).</summary>
    public float LastSettle;
    public string Reach(int i){var h=rig.GlobalTransform*rig.GetBoneGlobalPose(hips[i]).Origin;var p=BootPoint(i);return $"hip {h} boot {p} distance {h.DistanceTo(p):0.00} settle wanted {LastSettle:0.00}";}
    public float BootError(int i)=>(rig.GlobalTransform*rig.GetBoneGlobalPose(ankles[i]).Origin).DistanceTo(wasStriding?strideTarget[i]:BootPoint(i));
    /// <summary>Trunk lean after posing: radians forward of vertical, pelvis to neck.</summary>
    public float Lean(){var p=rig.GetBoneGlobalPose(pelvis).Origin;var n=rig.GetBoneGlobalPose(neck).Origin;return Mathf.Atan2(n.Z-p.Z,n.Y-p.Y);}
    /// <summary>Knee fold of the kicking leg: the shin's angle behind the thigh line, radians (never negative).</summary>
    public float KickKnee(){var h=rig.GetBoneGlobalPose(hips[1]).Origin;var k=rig.GetBoneGlobalPose(knees[1]).Origin;var a=rig.GetBoneGlobalPose(ankles[1]).Origin;
        var thigh=(k-h).Normalized();var shin=(a-k).Normalized();float fold=thigh.AngleTo(shin);return thigh.Cross(shin).X<-.02f?-fold:fold;}
}
