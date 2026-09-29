export type MantlePoint={x:number;y:number;z:number};
export interface MantleWorld {
  floor(x:number,z:number,ceiling:number):number;
  clear(x:number,y:number,z:number):boolean;
  stand(x:number,y:number,z:number):boolean;
}
export const MANTLE_REACH=1.65;
/** A short, checked lift and step. No unknown-height walls or blind jumps over a drop. */
export function findMantle(w:MantleWorld,from:MantlePoint,dx:number,dz:number,base=from.y):MantlePoint[]|null {
  const len=Math.hypot(dx,dz);if(len<.01)return null;dx/=len;dz/=len;
  const max=base+MANTLE_REACH;
  for(let d=.45;d<=1.25;d+=.16) {
    const x=from.x+dx*d,z=from.z+dz*d,y=w.floor(x,z,max);
    if(!Number.isFinite(y)||y<base+.42||y>max||!w.clear(x,y+.06,z))continue;
    const lift=Math.max(from.y,y)+.10;
    const clearLine=(a:MantlePoint,b:MantlePoint)=>{
      const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z)/.12));
      for(let i=0;i<=n;i++){const t=i/n;if(!w.clear(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,a.z+(b.z-a.z)*t))return false;}
      return true;
    };
    const up={x:from.x,y:lift,z:from.z};
    if(!clearLine(from,up))continue;
    // Prefer stepping over a narrow obstacle; otherwise stand on its broad top.
    const candidates:MantlePoint[]=[];
    for(let e=d+.35;e<=2.05;e+=.18) {
      const tx=from.x+dx*e,tz=from.z+dz*e,ty=w.floor(tx,tz,max);
      if(ty>=base-.45&&ty<y-.3&&w.stand(tx,ty,tz)){candidates.push({x:tx,y:ty,z:tz});break;}
    }
    if(w.stand(x,y,z))candidates.push({x,y,z});
    for(const end of candidates) {
      const over={x:end.x,y:lift,z:end.z};
      if(clearLine(up,over)&&clearLine(over,end))return [up,over,end];
    }
  }
  return null;
}
