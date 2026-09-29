export type MantlePoint={x:number;y:number;z:number;
  /** The last point only: open water below; the climb ends in the air over it and he drops in. */
  water?:boolean;
  /** The last point only: ground far below (a jump off a height, 2026-09-29: it may hurt); he drops onto it. */
  fall?:boolean};
export interface MantleWorld {
  floor(x:number,z:number,ceiling:number):number;
  clear(x:number,y:number,z:number):boolean;
  stand(x:number,y:number,z:number):boolean;
  /** The water's surface at (x, z) when he can drop in and swim there (a quay's railing over the river), else null. */
  water?(x:number,z:number):number|null;
}
export const MANTLE_REACH=1.65;
/** The deepest drop into water a vault may end in (a quay wall at low tide). */
export const MANTLE_WATER_DROP=6;
/** The deepest drop onto ground a vault may end in (a fall from more than 3 m hurts: server/src/player/fall.ts). */
export const MANTLE_FALL_DROP=25;
/**
 * A short, checked lift and step. No unknown-height walls or blind jumps over a drop (open water excepted).
 * 2026-09-29 (Steve: "jump over railings, ledges, low shrubs"): the lift clears the highest top between the
 * takeoff and the landing (a crate's rim, a bench's back), the landing is looked for up to 2.6 m out (over a
 * deep obstacle), and a railing over open water may be vaulted into it. Later that day (fall damage came in):
 * over a railing onto ground far below too.
 */
export function findMantle(w:MantleWorld,from:MantlePoint,dx:number,dz:number,base=from.y):MantlePoint[]|null {
  const len=Math.hypot(dx,dz);if(len<.01)return null;dx/=len;dz/=len;
  const max=base+MANTLE_REACH;
  const clearLine=(a:MantlePoint,b:MantlePoint)=>{
    const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)/.12));
    for(let i=0;i<=n;i++){const t=i/n;if(!w.clear(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t))return false;}
    return true;
  };
  /** The highest top on the way out to e metres (none above the reach: then a wall, null). */
  const topTo=(e:number)=>{
    let top=from.y;
    for(let s=.2;s<=e+1e-6;s+=.12){const t=w.floor(from.x+dx*s,from.z+dz*s,max);if(Number.isFinite(t))top=Math.max(top,t);}
    return top;
  };
  for(let d=.45;d<=1.25;d+=.16) {
    const x=from.x+dx*d,z=from.z+dz*d,y=w.floor(x,z,max);
    if(!Number.isFinite(y)||y<base+.42||y>max||!w.clear(x,y+.06,z))continue;
    // Prefer stepping over a narrow obstacle; otherwise stand on its broad top.
    const candidates:MantlePoint[]=[];
    for(let e=d+.35;e<=2.6;e+=.15) {
      const tx=from.x+dx*e,tz=from.z+dz*e,ty=w.floor(tx,tz,max);
      if(ty>=base-.45&&ty<y-.3&&w.stand(tx,ty,tz)){candidates.push({x:tx,y:ty,z:tz});break;}
      if(ty<base-.45&&w.water){
        // a jump carries him out from the quay's face: the first spots out over the water, nearest first
        for(let f=e;f<=e+.9;f+=.3){
          const fx=from.x+dx*f,fz=from.z+dz*f,lv=w.water(fx,fz);
          if(lv!==null&&lv<base-.3&&lv>base-MANTLE_WATER_DROP)candidates.push({x:fx,y:lv,z:fz,water:true});
        }
        if(candidates.length)break;
      }
      // over the edge of a height onto ground below (it may hurt): only onto ground he can stand on
      if(ty<base-.45&&ty>base-MANTLE_FALL_DROP&&w.stand(tx,ty,tz)){candidates.push({x:tx,y:ty,z:tz,fall:true});break;}
    }
    if(w.stand(x,y,z))candidates.push({x,y,z});
    for(const end of candidates) {
      const lift=Math.min(max,Math.max(y,topTo(Math.hypot(end.x-from.x,end.z-from.z))))+.10;
      const up={x:from.x,y:lift,z:from.z};
      if(!clearLine(from,up))continue;
      const over={x:end.x,y:lift,z:end.z};
      if(!clearLine(up,over))continue;
      // into the water: the drop must be free down to just over the surface (no boat, no pontoon)
      if(end.water){if(clearLine(over,{x:end.x,y:end.y+.3,z:end.z}))return [up,over,end];continue;}
      if(end.fall){if(clearLine(over,{x:end.x,y:end.y+.06,z:end.z}))return [up,over,end];continue;}
      if(clearLine(over,end))return [up,over,end];
    }
  }
  return null;
}
