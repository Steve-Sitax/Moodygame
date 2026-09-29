import PARK from "../client/public/models/park.json" with { type: "json" };

export const POND_LEVEL=-.35;
export const POND_BED=-2.75;
export const nearPark=(x:number,z:number)=>x>-395&&x< -215&&z>245&&z<380;
export function inPolygon(x:number,z:number,poly:readonly number[][]):boolean {
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const a=poly[i],b=poly[j];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function polygonDistance(x:number,z:number,poly:readonly number[][]):number {
  let best=Infinity;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
    const a=poly[j],b=poly[i],dx=b[0]-a[0],dz=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
    best=Math.min(best,Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t));
  }
  return best;
}
const touches=(x:number,z:number,p:number[][],r=0)=>inPolygon(x,z,p)||(r>0&&polygonDistance(x,z,p)<r);
const pondBounds={x0:Math.min(...PARK.pond.map(p=>p[0]))-1,x1:Math.max(...PARK.pond.map(p=>p[0]))+1,z0:Math.min(...PARK.pond.map(p=>p[1]))-1,z1:Math.max(...PARK.pond.map(p=>p[1]))+1};
const nearPond=(x:number,z:number)=>x>pondBounds.x0&&x<pondBounds.x1&&z>pondBounds.z0&&z<pondBounds.z1;
export const pondFootprint=(x:number,z:number)=>nearPond(x,z)&&inPolygon(x,z,PARK.water);
export const pondWater=(x:number,z:number)=>pondFootprint(x,z)&&!inPolygon(x,z,PARK.island.land);
export const pondShoreDistance=(x:number,z:number)=>Math.min(polygonDistance(x,z,PARK.water),polygonDistance(x,z,PARK.island.land));
export function pondSwimFree(x:number,z:number,r:number):boolean {
  if(!pondWater(x,z)||polygonDistance(x,z,PARK.water)<r||touches(x,z,PARK.island.land,r))return false;
  return !PARK.rocks.some(p=>touches(x,z,p,r));
}
/** Exact bank overrides the coarse walk map; the crowd still follows the original map. */
export function pondBank(x:number,z:number):number|null {
  if(!nearPond(x,z))return null;
  if(inPolygon(x,z,PARK.island.land))return PARK.island.top;
  if(pondFootprint(x,z))return null;
  if(inPolygon(x,z,PARK.pond))return Math.min(0,-.28+polygonDistance(x,z,PARK.water)*.3);
  // The raster expands the blocked rim by half a cell. Recover only its landward fringe,
  // never the adjacent rampart face where the pond meets the town wall.
  if(polygonDistance(x,z,PARK.pond)<.65&&polygonDistance(x,z,PARK.water_wall)>1)return 0;
  return null;
}
// Conservative tops include gate-pier ornaments; they are not extra climbable platforms.
const obstacles=[[PARK.railing,1.35],[PARK.piers,1.94],[PARK.benches,.95],[PARK.rocks,1.5],[PARK.bridge_rails,1.65],[PARK.lanterns,4.5]] as const;
const cells=new Map<string,Array<{poly:number[][];y:number}>>();
for(const [polys,y] of obstacles)for(const poly of polys) {
  const x0=Math.floor(Math.min(...poly.map(p=>p[0]))/4),x1=Math.floor(Math.max(...poly.map(p=>p[0]))/4);
  const z0=Math.floor(Math.min(...poly.map(p=>p[1]))/4),z1=Math.floor(Math.max(...poly.map(p=>p[1]))/4);
  const obstacle={poly,y};
  for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++) {
    const key=`${x},${z}`,list=cells.get(key)??[];list.push(obstacle);cells.set(key,list);
  }
}
export function parkObstacleTop(x:number,z:number,r=0):number|null {
  if(!nearPark(x,z))return null;
  let top:number|null=null;
  for(let cx=Math.floor((x-r)/4);cx<=Math.floor((x+r)/4);cx++)for(let cz=Math.floor((z-r)/4);cz<=Math.floor((z+r)/4);cz++)
    for(const {poly,y} of cells.get(`${cx},${cz}`)??[])
      if(touches(x,z,poly,r))top=Math.max(top??-Infinity,y);
  return top;
}
export const parkObstacleCell=(x:number,z:number)=>parkObstacleTop(x,z,.52)!==null;
