import TREE_LIFE from "./parkTreeLife.json" with { type: "json" };
/** Bounded park ecology, in metres and real simulation seconds. No renderer or wall-clock timers. */
export type Point = { x: number; z: number };
export type ParkSpecies = "duck" | "swan" | "goose" | "squirrel" | "songbird";
export type ParkMode = "swim" | "forage" | "feed" | "flight" | "climb" | "perch" | "shelter" | "defend" | "caught";
export interface ParkAnimal extends Point {
  id: number; species: ParkSpecies; female: boolean; young: boolean; parent: number | null;
  y: number; yaw: number; mode: ParkMode; timer: number; phase: number;
  home: number; alarm: number; target: Point; start: Point & { y: number }; flight: number; duration: number; branch:number; targetY:number;
}
export interface ParkHabitat {
  trees: Array<[number, number, string, number, number]>;
  birds: Array<[number, number, number, string]>;
  ground: { lawn: number[][]; gravel: number[][]; mud: number[][] };
}
export interface ParkEnvironment {
  hour: number; rain: number; storm: number;
  people: Point[]; boats: Point[]; cats: Point[]; dogs: Point[]; food: Point[];
  waterLevels?: number[];
  /** Where the player looks from: birds further than FAR_M are stepped once a second, not every frame. */
  focus?: Point;
}
/**
 * Water beyond the park the waterfowl fly to and from (checked open, swimmable water, 2026-09-29; Steve: "They can
 * also fly to the Schelde, and the different docks, put some more in the game"): [x, z, radius, flock living there].
 */
export const TOWN_WATERS: Array<[number, number, number, "duck" | "swan" | ""]> = [
  [-146, 50, 2, ""], // the Canal des Brasseurs by the Vismarkt
  [25, -10, 4, ""], // the Schelde off the Rijnkaai
  [-116, -10, 4, "duck"], // the Schelde off the Vismarkt
  [-273.6, -13.4, 4, "duck"], // the Schelde off the Werf
  [120, -8, 4, ""], // the Schelde off the Petit Bassin
  [75.6, 51, 4, "duck"], // the Petit Bassin
  [112.8, 97.7, 4, "duck"], // the south quay of the Petit Bassin
  [164, 98.6, 4, "swan"], // the dock by the Entrepot
  [-74.7, 112.6, 3, "duck"], // the Canal des Brasseurs
];
/** Birds further than this from the player are stepped coarsely (once a second). */
export const FAR_M = 160;
/** A person nearer than WARY makes a bird move off; nearer than CLOSE and still coming, it flies (metres). */
const WARY: Record<string, number> = { duck: 6, goose: 6.5, swan: 5 };
const CLOSE: Record<string, number> = { duck: 3, goose: 3.2, swan: 2.4 };
export const parkDistance = (a: Point, b: Point) => Math.hypot(a.x-b.x, a.z-b.z);
export function onParkGround(d: ParkHabitat, p: Point): boolean {
  return [d.ground.lawn, d.ground.gravel, d.ground.mud].some(tris => tris.some(t => {
    const cross = (a: number,b: number,c: number,e: number) => (p.x-c)*(b-e)-(a-c)*(p.z-e);
    const a=cross(t[0],t[1],t[2],t[3]), b=cross(t[2],t[3],t[4],t[5]), c=cross(t[4],t[5],t[0],t[1]);
    return !((a<0||b<0||c<0)&&(a>0||b>0||c>0));
  }));
}
export class ParkEcology {
  readonly animals: ParkAnimal[] = [];
  readonly events: string[] = [];
  private seed = 1873;
  private time = 0;
  private huntUntil = new Map<number, number>();
  private land = new Set<number>();
  private onLand(p:Point) {return this.land.has(Math.floor(p.x*4)*8192+Math.floor(p.z*4));}
  readonly habitat: ParkHabitat;
  /** How many homes are the park's own (the rest: TOWN_WATERS). */
  readonly parkHomes: number;
  /** Each bird's distance to the person it watches, last step (closing in or not). */
  private watched = new Map<number, number>();
  private farLag = 0;
  constructor(habitat: ParkHabitat) {
    this.parkHomes=habitat.birds.length;
    this.habitat={...habitat,birds:[...habitat.birds,...TOWN_WATERS.map(([x,z,r]):[number,number,number,string]=>[x,z,r,"duck"])]};
    // Rasterise once. A squirrel's step must not scan thousands of ground triangles every frame.
    for(const triangles of [habitat.ground.lawn,habitat.ground.gravel,habitat.ground.mud])for(const t of triangles) {
      const minX=Math.floor(Math.min(t[0],t[2],t[4])*4),maxX=Math.ceil(Math.max(t[0],t[2],t[4])*4);
      const minZ=Math.floor(Math.min(t[1],t[3],t[5])*4),maxZ=Math.ceil(Math.max(t[1],t[3],t[5])*4);
      for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++)if(onParkGround({trees:[],birds:[],ground:{lawn:[t],gravel:[],mud:[]}},{x:(x+.5)/4,z:(z+.5)/4}))this.land.add(x*8192+z);
    }
    habitat.birds.forEach(([x,z,r,kind],home) => {
      const species = kind === "swan" ? "swan" : "duck";
      let mother = 0;
      for(let i=0;i<(species === "duck"?6:3);i++) {
        const a=this.add(species,x+Math.cos(i)*r*.45,z+Math.sin(i)*r*.45,home);
        a.female=i===0 || i===2; a.young=i>2 || (species==="swan"&&i===2);
        if(i===0)mother=a.id;
        if(a.young)a.parent=mother;
      }
    });
    // the flocks that live out on the town's water
    TOWN_WATERS.forEach(([x,z,r,kind],i)=>{
      if(!kind)return;
      const home=this.parkHomes+i;let mother=0;
      for(let k=0;k<(kind==="duck"?5:3);k++) {
        const a=this.add(kind,x+Math.cos(k)*r*.45,z+Math.sin(k)*r*.45,home);
        a.female=k===0||k===2;a.young=kind==="swan"?k===2:k>2;
        if(k===0)mother=a.id;
        if(a.young)a.parent=mother;
      }
    });
    if(habitat.birds.length)for(let i=0;i<6;i++) {
      const home=i%habitat.birds.length,[x,z,r]=habitat.birds[home];
      const a=this.add("goose",x+Math.cos(i)*r*.6,z+Math.sin(i)*r*.6,home);a.female=i%2===0;
    }
    habitat.trees.filter(t=>t[2]!=="conifer"&&t[2]!=="old_bare").filter((_,i)=>i%4===0).slice(0,10).forEach(t=> {
      const home=habitat.trees.indexOf(t); const a=this.add("squirrel",t[0]+(t[2]==="old_oak"?1.8:.45),t[1],home);
      a.mode="forage"; a.y=.08;
    });
    const oak=habitat.trees.findIndex(t=>t[2]==="old_oak");
    if(oak>=0)for(let i=0;i<6;i++) {
      const a=this.add("songbird",0,0,oak);a.branch=i;
      Object.assign(a,this.branchPoint(a));a.mode="perch";a.timer=3+i*3;
    }
  }
  private random() { this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296; }
  private add(species: ParkSpecies,x:number,z:number,home:number) {
    const a: ParkAnimal={id:this.animals.length,species,x,z,y:-.34,yaw:0,female:false,young:false,parent:null,mode:"swim",timer:3+this.random()*12,phase:this.random()*6.28,home,alarm:0,target:{x,z},start:{x,z,y:-.34},flight:0,duration:0,branch:0,targetY:0};
    this.animals.push(a); return a;
  }
  private note(s:string) {this.events.push(s);if(this.events.length>12)this.events.shift();}
  private go(a:ParkAnimal,p:Point,speed:number,dt:number,land=false) {
    const d=parkDistance(a,p);if(d<.05)return;
    const f=Math.min(1,speed*dt/d),x=a.x+(p.x-a.x)*f,z=a.z+(p.z-a.z)*f;
    if(land&&!this.onLand({x,z})) {a.timer=0;return;}
    a.yaw=Math.atan2(-(p.z-a.z),p.x-a.x);a.x=x;a.z=z;
  }
  /** Another home to fly to: `away` one of the town's waters, else another of the park's (from the town: the park). */
  private elsewhere(a:ParkAnimal,away:boolean):number {
    const n=this.habitat.birds.length,town=n-this.parkHomes;
    if(away&&town>0){const h=this.parkHomes+Math.floor(this.random()*town);return h===a.home?this.parkHomes+(h-this.parkHomes+1)%town:h;}
    if(a.home>=this.parkHomes||this.parkHomes<2)return Math.floor(this.random()*Math.max(1,this.parkHomes));
    return (a.home+1)%this.parkHomes;
  }
  private fly(a:ParkAnimal,home:number,away=false) {
    const h=this.habitat.birds[home];if(!h)return;
    const destination=this.habitat.birds[home];
    a.start={x:a.x,z:a.z,y:a.y};a.target={x:destination[0]+Math.cos(a.phase)*destination[2]*.65,z:destination[1]+Math.sin(a.phase)*destination[2]*.65};a.home=home;
    a.duration=Math.max(4,parkDistance(a,a.target)/(a.species==="swan"?6:8));
    // A longer arch reads as a departing/returning flock, without landing on streets or roofs.
    if(away||parkDistance(a,a.target)>60)a.duration+=12;
    a.flight=0;a.mode="flight";a.timer=away?22:5;
  }
  private hasBrood(a:ParkAnimal) {return this.animals.some(child=>child.parent===a.id&&child.mode!=="caught");}
  /** A real town cat can stalk this target through the ordinary animal pathfinder. */
  huntTarget(cat:Point): Point|null {
    if(this.animals.some(a=>a.mode==="defend"&&parkDistance(a,cat)<3)) {
      const a=this.animals.find(a=>a.mode==="defend"&&parkDistance(a,cat)<3)!;
      const d=parkDistance(a,cat)||1;return {x:cat.x+(cat.x-a.x)/d*5,z:cat.z+(cat.z-a.z)/d*5};
    }
    const prey=this.animals.filter(a=>(a.mode==="forage"||a.mode==="feed")&&a.y<.5&&a.species!=="swan"&&parkDistance(a,cat)<9).sort((a,b)=>parkDistance(a,cat)-parkDistance(b,cat))[0];
    return prey?{x:prey.x,z:prey.z}:null;
  }
  update(seconds:number,env:ParkEnvironment) {
    if(!Number.isFinite(seconds)||seconds<=0)return;
    // Fixed small steps keep escape, capture and shore tests independent of frame rate. Birds far from the player
    // (out on the docks) take one step a second: nobody sees them closely, and every frame stays cheap.
    const f=env.focus,near=(a:ParkAnimal)=>!f||parkDistance(a,f)<FAR_M;
    let left=Math.min(seconds,30);
    while(left>0) {const dt=Math.min(left,.1);this.step(dt,env,near);left-=dt;}
    if(f) {
      this.farLag+=Math.min(seconds,30);
      if(this.farLag>=1){const dt=Math.min(this.farLag,5);this.farLag=0;this.step(dt,env,a=>!near(a),false);}
    }
  }
  private step(dt:number,e:ParkEnvironment,only:(a:ParkAnimal)=>boolean=()=>true,clock=true) {
    if(clock)this.time+=dt;
    const shelter=e.storm>.35||e.rain>.8||e.hour<6.5||e.hour>19;
    // Parents decide first, regardless of array order: otherwise the mother flees before her young warn her.
    if(!shelter)for(const child of this.animals)if(child.young&&child.parent!==null&&child.mode!=="caught") {
      const cat=e.cats.find(p=>parkDistance(child,p)<5),mother=this.animals[child.parent];
      if(cat&&mother.mode!=="flight"&&parkDistance(child,mother)<6) {mother.mode="defend";mother.timer=5;mother.target={...cat};}
    }
    for(const a of this.animals) {
      if(!only(a))continue;
      a.timer-=dt;
      if(a.mode==="caught") {if(a.timer<0&&!e.people.some(p=>parkDistance(a,p)<35)) {a.mode="shelter";a.timer=10;}else continue;}
      if(a.species==="squirrel") {this.squirrel(a,dt,e,shelter);continue;}
      if(a.species==="songbird") {this.songbird(a,dt,e,shelter);continue;}
      const h=this.habitat.birds[a.home];
      const waterY=e.waterLevels?.[a.home]??-.34;
      if(a.mode==="flight") {
        a.flight+=dt;const f=Math.min(1,a.flight/a.duration),smooth=f*f*(3-2*f);
        a.x=a.start.x+(a.target.x-a.start.x)*smooth;a.z=a.start.z+(a.target.z-a.start.z)*smooth;
        a.y=a.start.y*(1-f)+waterY*f+Math.sin(Math.PI*f)*(a.duration>12?42:4.5);
        a.yaw=Math.atan2(-(a.target.z-a.start.z),a.target.x-a.start.x);
        if(f===1) {a.mode="swim";a.timer=16+this.random()*18;}
        continue;
      }
      const cat=e.cats.find(p=>parkDistance(a,p)<5);
      const mother=a.parent===null?null:this.animals[a.parent];
      const guarded=!!mother&&parkDistance(a,mother)<5;
      if(a.young&&cat&&mother&&mother.mode!=="flight") {mother.mode="defend";mother.timer=5;mother.target={...cat};}
      if(cat&&a.y>-.1&&a.species==="duck"&&parkDistance(a,cat)<.55&&!guarded&&(this.huntUntil.get(a.id)??0)<this.time) {
        this.huntUntil.set(a.id,this.time+45);
        if(this.random()<.12) {a.mode="caught";a.timer=240;this.note("A cat caught an unguarded duck. The flock scattered.");continue;}
      }
      if(a.mode==="defend"&&a.timer>0&&cat) {a.yaw=Math.atan2(-(cat.z-a.z),cat.x-a.x);continue;}
      const fear=(cat&&parkDistance(a,cat)<(a.mode==="feed"?1.2:3)?cat:undefined)||e.dogs.find(p=>parkDistance(a,p)<4)||e.boats.find(p=>parkDistance(a,p)<7);
      // 2026-09-29 (Steve: "birds / swans / ducks fly away if you come too near. they try to swim or walk away but if
      // you keep getting closer, they fly"): a person near makes them move off; still coming and close, they fly
      let person:Point|undefined,pd=Infinity;
      for(const p of e.people){const d=parkDistance(a,p);if(d<pd){pd=d;person=p;}}
      if(pd>=(WARY[a.species]??6))person=undefined;
      const close=CLOSE[a.species]??3,last=this.watched.get(a.id)??pd;
      if(person)this.watched.set(a.id,pd);else this.watched.delete(a.id);
      const pressed=!!person&&pd<close&&(pd<last-.002||pd<close*.55);
      a.alarm=fear||pressed?a.alarm+dt:Math.max(0,a.alarm-dt*.5);
      if((fear||pressed)&&!shelter&&a.alarm>(fear===cat ? .65 : fear ? .08 : a.species==="swan" ? .9 : .5)) {
        // Unfledged young retreat with their parent on the pond; they cannot fly over the city.
        if(a.young||this.hasBrood(a)) {a.mode="swim";a.target={x:h[0],z:h[1]};this.go(a,a.target,1.9,dt);a.y=this.onLand(a)?.06:waterY;continue;}
        // half to another pond of the park, half out to the river or a dock
        const away=this.random()<.5;
        this.fly(a,this.elsewhere(a,away),away);a.alarm=0;this.watched.delete(a.id);continue;
      }
      if(person&&!shelter) {
        // off, away from him: swimming within their water, walking on the grass
        const d=pd||1,wet=!this.onLand(a);
        let tx=a.x+(a.x-person.x)/d*2.5,tz=a.z+(a.z-person.z)/d*2.5;
        if(wet){const r=h[2]*1.15,hx=tx-h[0],hz=tz-h[1],hd=Math.hypot(hx,hz);if(hd>r){tx=h[0]+hx/hd*r;tz=h[1]+hz/hd*r;}}
        a.target={x:tx,z:tz};a.timer=Math.max(a.timer,3);
        this.go(a,a.target,a.species==="swan"?.6:a.species==="goose"?.85:.9,dt,!wet);
        a.y=this.onLand(a)?.06:waterY;
        a.mode=a.y>0?"forage":"swim";
        continue;
      }
      if(shelter) {a.mode="shelter";this.go(a,{x:h[0],z:h[1]},.35,dt);a.y=waterY;continue;}
      if(a.mode==="shelter") {a.mode="swim";a.timer=5;}
      const food=e.food.find(p=>parkDistance(a,p)<14);
      if(food) {a.mode="feed";a.target=food;}
      else if(a.mode==="feed") {a.mode="swim";a.timer=0;}
      if(a.timer<=0&&!food) {
        if(!a.young&&!this.hasBrood(a)&&this.random()<.22) {const away=this.random()<.4;this.fly(a,this.elsewhere(a,away),away);continue;}
        const angle=this.random()*Math.PI*2;
        a.target={x:h[0]+Math.cos(angle)*h[2]*.75,z:h[1]+Math.sin(angle)*h[2]*.75};
        a.mode="swim";a.timer=7+this.random()*13;
        if(a.species==="goose")for(let n=0;n<12;n++) {
          const angle=this.random()*Math.PI*2,r=h[2]+1+this.random()*3;
          const grass={x:h[0]+Math.cos(angle)*r,z:h[1]+Math.sin(angle)*r};
          if(this.onLand(grass)){a.target=grass;a.mode="forage";a.timer=18+this.random()*12;break;}
        }
      }
      const target=a.young&&mother&&mother.mode!=="flight"?{x:mother.x-.6*Math.cos(a.phase),z:mother.z-.6*Math.sin(a.phase)}:a.target;
      this.go(a,target,a.mode==="feed"?.8:a.species==="swan"?.27:.46,dt);
      // Food is supplied only at a verified shoreline: birds walk the last part on land.
      a.y=this.onLand(a)? .06:waterY;
      if(a.y>0&&a.mode!=="feed")a.mode="forage";
    }
    // Personal space on the water; landing birds have distinct targets and gently part after arrival.
    for(let i=0;i<this.animals.length;i++) {
      const a=this.animals[i];if(!only(a)||!["duck","swan","goose"].includes(a.species)||a.mode==="flight"||a.mode==="caught")continue;
      for(let j=i+1;j<this.animals.length;j++) {
        const b=this.animals[j];if(!only(b)||!["duck","swan","goose"].includes(b.species)||b.mode==="flight"||b.mode==="caught")continue;
        const d=parkDistance(a,b),gap=(a.species==="swan"?.62:.31)+(b.species==="swan"?.62:.31);
        if(d>=gap)continue;
        const dx=d>.001?(a.x-b.x)/d:Math.cos(i*2.399),dz=d>.001?(a.z-b.z)/d:Math.sin(i*2.399),push=(gap-d)*Math.min(.45,dt*2);
        for(const [bird,sign] of [[a,1],[b,-1]] as const) {
          const p={x:bird.x+dx*push*sign,z:bird.z+dz*push*sign},h=this.habitat.birds[bird.home];
          if(bird.mode==="feed"||Math.hypot(p.x-h[0],p.z-h[1])<h[2]*.92){bird.x=p.x;bird.z=p.z;}
        }
      }
    }
  }
  private branchPoint(a:ParkAnimal):Point&{y:number} {
    const t=this.habitat.trees[a.home],p=TREE_LIFE.old_oak.perches[a.branch%6],c=Math.cos(t[4]),s=Math.sin(t[4]);
    // On the upper surface of the scaffold limb, before the spray of twigs at its fork.
    const f=.82,start=3.35+(a.branch%6)*.75;
    return {x:t[0]+(p[0]*c+p[2]*s)*t[3]*f,y:(p[1]*f+start*(1-f)+.04)*t[3],z:t[1]+(-p[0]*s+p[2]*c)*t[3]*f};
  }
  private songbird(a:ParkAnimal,dt:number,e:ParkEnvironment,shelter:boolean) {
    const t=this.habitat.trees[a.home];
    if(a.mode==="flight") {
      a.flight=Math.min(1,a.flight+dt/a.duration);const f=a.flight;
      a.x=a.start.x+(a.target.x-a.start.x)*f;a.z=a.start.z+(a.target.z-a.start.z)*f;
      a.y=a.start.y+(a.targetY-a.start.y)*f+Math.sin(Math.PI*f)*2.1;
      a.yaw=Math.atan2(-(a.target.z-a.start.z),a.target.x-a.start.x);
      if(f===1){a.mode=a.targetY<.2?"forage":"perch";a.timer=7+this.random()*16;}
      return;
    }
    const danger=e.cats.concat(e.dogs,e.people).some(p=>parkDistance(a,p)<3&&a.y<2);
    if(a.timer>0&&!danger&&!(shelter&&a.y<2))return;
    if(shelter&&a.y>2){a.mode="shelter";a.timer=10;return;}
    let p:Point&{y:number};
    const angle=this.random()*6.28,ground={x:t[0]+Math.cos(angle)*2.5,z:t[1]+Math.sin(angle)*2.5,y:.03};
    if(!shelter&&!danger&&a.y>2&&this.random()<.4&&this.onLand(ground))p=ground;
    else {
      const available=Array.from({length:6},(_,i)=>i).filter(i=>(a.y<2||i!==a.branch)&&!this.animals.some(b=>b!==a&&b.species==="songbird"&&b.home===a.home&&b.branch===i&&b.mode!=="forage"));
      if(available.length)a.branch=available[Math.floor(this.random()*available.length)];
      p=this.branchPoint(a);
      if(a.y>2&&parkDistance(a,p)<.1){a.timer=4;return;}
    }
    a.start={x:a.x,y:a.y,z:a.z};a.target=p;a.targetY=p.y;a.flight=0;a.duration=Math.max(1.2,Math.hypot(a.x-p.x,a.z-p.z,a.y-p.y)/4);a.mode="flight";
  }
  private squirrel(a:ParkAnimal,dt:number,e:ParkEnvironment,shelter:boolean) {
    const tree=this.habitat.trees[a.home], trunk={x:tree[0],z:tree[1]};
    const oak=tree[2]==="old_oak",radius=(oak?TREE_LIFE.old_oak.trunkRadius:.24)*tree[3],top=(oak?TREE_LIFE.old_oak.climbHeight:3.3)*tree[3];
    const danger=e.people.concat(e.dogs,e.cats).some(p=>parkDistance(a,p)<3);
    if((danger||shelter)&&a.mode!=="perch")a.mode="climb";
    if(a.mode==="climb") {
      this.go(a,{x:trunk.x+radius,z:trunk.z},2.8,dt,true);
      if(parkDistance(a,trunk)<radius+.4) {a.y=Math.min(top,a.y+dt*1.7);a.x=trunk.x+radius;a.z=trunk.z;a.yaw=Math.PI;
        if(a.y>=top){a.mode="perch";a.flight=0;a.timer=8+this.random()*18;}}
      return;
    }
    if(a.mode==="perch") {
      if(oak) {
        a.flight=Math.max(0,Math.min(1,a.flight+(a.timer>0||shelter||danger?dt:-dt)*.35));
        const p=this.branchPoint(a),f=a.flight;
        if(f>0){a.x=trunk.x+radius+(p.x-trunk.x-radius)*f;a.z=trunk.z+(p.z-trunk.z)*f;a.y=top+(p.y-top)*f-.4*Math.sin(Math.PI*f);a.yaw=Math.atan2(-(p.z-trunk.z),p.x-trunk.x);}
        if(a.flight>0){if(shelter||danger)a.timer=Math.max(a.timer,5);return;}
      }
      if(shelter||danger){a.timer=Math.max(a.timer,5);return;}
      if(a.timer<=0) {a.y=Math.max(.08,a.y-dt*1.4);if(a.y<=.08){a.mode="forage";a.timer=0;}}
      return;
    }
    if(a.mode==="feed"&&a.timer>0){a.y=.08;return;}
    if(a.mode==="feed")a.mode="forage";
    if(a.mode==="forage"&&parkDistance(a,a.target)<.18&&a.timer>0) {
      a.mode="feed";a.timer=2+this.random()*4;a.y=.08;return;
    }
    if(a.timer<=0) {
      const angle=this.random()*6.28,r=1+this.random()*3;
      a.target={x:trunk.x+Math.cos(angle)*r,z:trunk.z+Math.sin(angle)*r};
      a.timer=3+this.random()*6;
      if(this.random()<.18)a.mode="climb";
    }
    this.go(a,a.target,1.1,dt,true);a.y=.08+Math.abs(Math.sin(this.time*13+a.phase))*.08;
  }
}
