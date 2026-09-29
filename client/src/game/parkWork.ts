import * as THREE from "three";
import { PARK_KEEPER, PARK_KEEPER_HOME, PARK_FEED, PARK_CLEAN_COUNT, PARK_CLEAN_PAY, type ParkWorkView } from "../../../shared/parkWork";
import { parkLife } from "../world/parkWildlife";
import { psx, psxUniforms } from "../retro/psx";
import { tempest } from "../world/tempest";
import { reachArm } from "./reach";
import { makeHuman, whenHumans, type Human } from "./humans";
import type { World } from "../world/rijnkaai";
import type { Jobs } from "./jobs";
import type { Town } from "./town";
import type { Crowd, Puppet } from "./crowd";
import type { FirstPerson } from "../player/firstPerson";
import type { Animals } from "./animals";
import type { Action } from "./runs";
import type { JobsPayload } from "../net/api";
import { DEMO } from "../demo/demo";

/** The keeper, his public work board, shared droppings, feeding, and the player's scoop. */
export class ParkWork {
  private state:ParkWorkView|null=null;
  private keeper:Human|null=null;
  private root=new THREE.Group();
  private piles:THREE.InstancedMesh;
  private marks:THREE.InstancedMesh;
  private scoop=new THREE.Group();
  private bucket=new THREE.Group();
  private tool=new THREE.Group();
  private busy=false; private poll=0; private feed=0;
  private cleaning:{id:number;left:number}|null=null;
  private workerPath:Array<{x:number;z:number}>=[];
  private workerTarget:number|null=null;
  private workerWait=0;
  private wasSheltering=false;
  private shelterRetry=0;
  private temp=new THREE.Object3D();
  private at={x:PARK_KEEPER.x-1,z:PARK_KEEPER.z};
  private grip=new THREE.Vector3();
  private elbow=new THREE.Vector3(1,0,1);
  private feeder:{id:string;puppet:Puppet;shore:{x:number;z:number};left:number;scattered:boolean}|null=null;
  constructor(world:World,private player:FirstPerson,private jobs:Jobs,private town:Town,private crowd:Crowd,animals:Animals) {
    this.root.name="park_keeper_and_work";world.scene.add(this.root);
    const brown=psx(new THREE.MeshLambertMaterial({color:0x4c3520}),{affine:0});brown.name="park_droppings";
    this.piles=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.105,1).scale(1.25,.6,.8),brown,48);
    this.piles.count=0;this.piles.frustumCulled=false;this.piles.name="park_dog_droppings";this.root.add(this.piles);
    const markerMat=psx(new THREE.MeshLambertMaterial({color:0xc4ab64}),{affine:0});markerMat.name="park_work_mark";
    this.marks=new THREE.InstancedMesh(new THREE.TorusGeometry(.21,.009,3,12).rotateX(Math.PI/2),markerMat,10);
    this.marks.count=0;this.marks.frustumCulled=false;this.root.add(this.marks);
    const wood=psx(new THREE.MeshLambertMaterial({color:0x63503a}),{affine:0});wood.name="park_tool_wood";
    const iron=psx(new THREE.MeshLambertMaterial({color:0x424440}),{affine:0});iron.name="park_tool_iron";
    const makeTool=()=>{
      const g=new THREE.Group(),handle=new THREE.Mesh(new THREE.CylinderGeometry(.015,.019,1.1,6),wood);
      handle.position.y=.55;
      const pan=new THREE.Mesh(new THREE.BoxGeometry(.23,.025,.25),iron);pan.position.z=.10;g.add(handle,pan);return g;
    };
    this.scoop.add(makeTool());world.scene.add(this.scoop);this.scoop.visible=false;
    this.tool.add(makeTool());this.root.add(this.tool);
    const pot=new THREE.Mesh(new THREE.CylinderGeometry(.19,.14,.31,8,1,true),iron);pot.position.y=.17;this.bucket.add(pot);
    const hoop=new THREE.Mesh(new THREE.TorusGeometry(.16,.012,4,10,Math.PI),iron);hoop.position.y=.31;this.bucket.add(hoop);this.root.add(this.bucket);
    const board=new THREE.Mesh(new THREE.BoxGeometry(.75,.6,.065),wood);board.position.set(PARK_KEEPER.x,.95,PARK_KEEPER.z);this.root.add(board);
    const canvas=document.createElement("canvas");canvas.width=256;canvas.height=192;const ctx=canvas.getContext("2d")!;
    ctx.fillStyle="#d0c09d";ctx.fillRect(0,0,256,192);ctx.fillStyle="#30271c";ctx.textAlign="center";
    ctx.font="bold 27px Georgia";ctx.fillText("PARK WORK",128,40);ctx.font="22px Georgia";
    ctx.fillText("Clear 10 droppings",128,83);ctx.fillText(`${PARK_CLEAN_PAY} centimes`,128,119);ctx.font="16px Georgia";ctx.fillText("Scoop & bucket provided",128,155);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const signMat=psx(new THREE.MeshLambertMaterial({map:texture}),{affine:0});signMat.name="park_work_notice_paper";
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(.7,.53),signMat);sign.position.copy(board.position);sign.position.z+=.036;this.root.add(sign);
    const post=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,1,6),wood);post.position.set(PARK_KEEPER.x,.48,PARK_KEEPER.z);this.root.add(post);
    whenHumans(()=>{this.keeper=makeHuman("docker_b");if(this.keeper)this.root.add(this.keeper.root);});
    jobs.extraActions.push(()=>this.actions());
    parkLife.people=()=>town.inStreet(-302,310,70);
    parkLife.cats=()=>animals.list.filter(a=>a.species==="cat"&&Math.hypot(a.x+302,a.z-310)<70);
    parkLife.dogs=()=>animals.list.filter(a=>a.species==="dog"&&Math.hypot(a.x+302,a.z-310)<70);
    animals.parkDeposit=(owner,x,z)=>{if(!DEMO)void this.call("dog",{owner,at:{x,z}},false);};
    if(import.meta.env.DEV)Object.assign(window,{__parkWork:this,__parkLife:parkLife});
  }
  private async call(action:string,body:Record<string,unknown>,say=true) {
    try {
      const r=await fetch(`/api/park/${action}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const data=await r.json();if(!r.ok)throw new Error(data.error??"The keeper could not do that.");
      this.state=data.park;this.jobs.refresh(data.state as JobsPayload);this.drawPiles();if(say&&data.text)this.jobs.say(data.text);
      return true;
    }catch(e){if(say)this.jobs.say(String((e as Error).message));return false;}
  }
  private actions():{options?:Array<[number,Action]>} {
    if(DEMO||!this.state||this.busy||this.cleaning)return {};
    const x=this.player.x,z=this.player.z,options:Array<[number,Action]>=[];
    const d=Math.hypot(x-PARK_KEEPER.x,z-PARK_KEEPER.z),shift=this.state.shift;
    if(this.state.open&&d<2.6&&!shift) options.push([d,{key:"KeyE",text:`park work: clear 10 droppings — ${PARK_CLEAN_PAY} c`,at:{...PARK_KEEPER,y:1},run:()=>{this.busy=true;void this.call("take",{at:{x,z}}).finally(()=>this.busy=false);}}]);
    if(d<2.6&&shift&&!shift.paid)options.push([d,{key:"KeyF",text:"return the scoop and abandon the round",at:{...PARK_KEEPER,y:1},run:()=>{this.busy=true;void this.call("cancel",{at:{x,z}}).finally(()=>this.busy=false);}}]);
    if(!this.state.open)return {options};
    for(const p of this.state.piles) {
      if(!shift||shift.paid||!shift.ids.includes(p.id))continue;
      const dist=Math.hypot(x-p.x,z-p.z);if(dist>2.1)continue;
      options.push([dist,{key:"KeyE",text:`scoop droppings (${shift.cleaned.length}/${PARK_CLEAN_COUNT})`,at:{...p,y:.08},run:()=>{
        this.busy=true;void this.call("prepare",{id:p.id,at:{x,z}},false).then(ok=>{if(ok)this.cleaning={id:p.id,left:1.9};}).finally(()=>this.busy=false);
      }}]);
    }
    for(const p of PARK_FEED) {const dist=Math.hypot(x-p.x,z-p.z);if(dist<2.6)options.push([dist,{key:"KeyG",text:"scatter grain for the birds — 1 c",at:{...p,y:.2},run:()=>{
      this.busy=true;void this.call("feed",{at:{x,z}}).then(ok=>{if(ok)parkLife.feed(p.x,p.z,22);}).finally(()=>this.busy=false);
    }}]);}
    return {options};
  }
  private drawPiles() {
    this.piles.count=0;this.marks.count=0;
    for(const p of this.state?.piles??[]) {
      this.temp.position.set(p.x,.065,p.z);this.temp.rotation.set(0,p.id*2.399,0);this.temp.scale.set(1,1,1);this.temp.updateMatrix();
      this.piles.setMatrixAt(this.piles.count++,this.temp.matrix);
      if(this.state?.shift?.ids.includes(p.id)&&!this.state.shift.paid) {this.temp.position.y=.018;this.temp.updateMatrix();this.marks.setMatrixAt(this.marks.count++,this.temp.matrix);}
    }
    this.piles.instanceMatrix.needsUpdate=true;this.marks.instanceMatrix.needsUpdate=true;
  }
  update(dt:number) {
    const near=Math.hypot(this.player.x+302,this.player.z-310)<125;this.root.visible=near;
    if(!near){if(this.feeder){this.town.release(this.feeder.id);this.feeder=null;}return;}
    if(!DEMO&&(this.poll-=dt)<=0) {this.poll=3;void fetch("/api/park").then(r=>r.ok?r.json():null).then(s=>{if(s){this.state=s;this.drawPiles();}}).catch(()=>{});}
    const hour=this.jobs.day.hourF,shelter=tempest.level>.3||psxUniforms.uRain.value>.8||hour<7||hour>=18;
    if(this.keeper) {
      if(shelter!==this.wasSheltering) {
        this.wasSheltering=shelter;this.workerTarget=null;this.workerWait=0;this.shelterRetry=1;
        const destination=shelter?PARK_KEEPER_HOME:{x:PARK_KEEPER.x-1,z:PARK_KEEPER.z};
        this.workerPath=this.crowd.pathOn(this.at.x,this.at.z,destination.x,destination.z)??[];
      }
      const working=!shelter&&Math.hypot(this.player.x-this.at.x,this.player.z-this.at.z)>4;
      const available=(this.state?.piles??[]).filter(p=>p.owner===null);
      if(working&&!this.workerPath.length&&this.workerTarget===null&&available.length>PARK_CLEAN_COUNT) {
        const p=available.sort((a,b)=>Math.hypot(a.x-this.at.x,a.z-this.at.z)-Math.hypot(b.x-this.at.x,b.z-this.at.z))[0];
        this.workerPath=this.crowd.pathOn(this.at.x,this.at.z,p.x,p.z)??[];
        if(this.workerPath.length)this.workerTarget=p.id;
      }
      if(shelter) {
        this.workerTarget=null;
        if((this.shelterRetry-=dt)<=0) {
          this.shelterRetry=1;
          if(!this.workerPath.length&&Math.hypot(this.at.x-PARK_KEEPER_HOME.x,this.at.z-PARK_KEEPER_HOME.z)>1)
            this.workerPath=this.crowd.pathOn(this.at.x,this.at.z,PARK_KEEPER_HOME.x,PARK_KEEPER_HOME.z)??[];
        }
      }
      let walking=false;
      if((working||shelter)&&this.workerPath.length) {
        const p=this.workerPath[0],d=Math.hypot(p.x-this.at.x,p.z-this.at.z),step=Math.min(d,dt*.85);
        if(d>.03) {this.at.x+=(p.x-this.at.x)*step/d;this.at.z+=(p.z-this.at.z)*step/d;this.keeper.root.rotation.y=Math.atan2(p.x-this.at.x,p.z-this.at.z);walking=true;}
        if(d<.12)this.workerPath.shift();
      }
      const cleaning=working&&!this.workerPath.length&&this.workerTarget!==null;
      if(cleaning&&(this.workerWait+=dt)>3) {const id=this.workerTarget;this.workerTarget=null;this.workerWait=0;void this.call("keeper",{id,at:{...this.at}},false);}
      this.keeper.root.position.set(this.at.x,0,this.at.z);this.keeper.play(walking?"walk":cleaning?"scrub":"idle");this.keeper.setPace(.85);this.keeper.update(dt);
      this.keeper.root.position.y=this.keeper.motionLift();
      this.keeper.root.visible=this.tool.visible=this.bucket.visible=!(shelter&&Math.hypot(this.at.x-PARK_KEEPER_HOME.x,this.at.z-PARK_KEEPER_HOME.z)<.8);
      this.bucket.position.set(this.at.x+.45,0,this.at.z);this.tool.position.set(this.at.x+.25,.05,this.at.z+.3);
      this.tool.rotation.z=cleaning?Math.sin(this.workerWait*5)*.18:-.15;
      this.tool.updateWorldMatrix(true,true);
      this.grip.set(0,.66,0);this.tool.localToWorld(this.grip);reachArm(this.keeper.root,"L",this.grip,this.elbow);
      if(walking) {this.keeper.root.getObjectByName("handR")?.getWorldPosition(this.bucket.position);this.bucket.position.y-=.47;}

    }
    this.scoop.visible=!!this.cleaning;
    if(this.cleaning) {
      const p=this.state?.piles.find(p=>p.id===this.cleaning!.id);
      if(!p||Math.hypot(p.x-this.player.x,p.z-this.player.z)>2.1){this.cleaning=null;this.scoop.visible=false;return;}
      this.scoop.position.set(p.x,.08,p.z);this.scoop.rotation.z=Math.sin(this.cleaning.left*5)*.3;
      this.cleaning.left-=dt;
      if(this.cleaning.left<=0) {const id=this.cleaning.id;this.cleaning=null;this.busy=true;void this.call("clean",{id,at:{x:this.player.x,z:this.player.z}}).finally(()=>this.busy=false);}
    }
    // Borrow one nearby visitor briefly; walk to the bank, scatter grain, then resume their own day.
    if(this.feeder) {
      const f=this.feeder;f.left-=dt;
      if(shelter||f.left<=0) {this.town.release(f.id);this.feeder=null;}
      else if(!f.scattered&&Math.hypot(f.puppet.x-f.shore.x,f.puppet.z-f.shore.z)<1) {
        f.scattered=true;f.left=9;
        this.crowd.puppetStand(f.puppet,"talk",Math.atan2(f.shore.x-f.puppet.x,f.shore.z+2-f.puppet.z));
        parkLife.feed(f.shore.x,f.shore.z,20);
      }
    }
    if(!shelter&&!this.feeder&&(this.feed-=dt)<=0) {
      this.feed=25;
      for(const shore of PARK_FEED) {
        const person=this.town.inStreet(shore.x,shore.z,9).find(p=>p.age>=12&&!this.town.held(p.id)&&this.crowd.pathOn(p.x,p.z,shore.x,shore.z));
        if(!person)continue;
        const puppet=this.town.claim(person.id);if(!puppet)continue;
        this.crowd.puppetGo(puppet,shore.x,shore.z,.8);
        this.feeder={id:person.id,puppet,shore,left:30,scattered:false};break;
      }
    }
  }
  pathPoints() {return [
    {label:"park work board",...PARK_KEEPER,reach:2},
    {label:"park keeper home",...PARK_KEEPER_HOME,reach:1},
    ...PARK_FEED.map((p,i)=>({label:`park feeding bank ${i+1}`,...p,reach:1})),
  ];}
  info() {return {state:this.state,keeper:this.at,cleaning:this.cleaning,wildlife:parkLife.ecology?.animals,events:parkLife.ecology?.events};}
}
