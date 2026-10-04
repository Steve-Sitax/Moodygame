// The room marks for Godot's people, from the same plans and roles as the browser. No scene bake.
import { readFileSync, writeFileSync } from 'node:fs';
import { PLAN as townhall } from '../../shared/townhallPlan.ts';
import { PLAN as vleeshuis } from '../../shared/vleeshuisPlan.ts';
import { PLAN as steen } from '../../shared/steenPlan.ts';
import { PLAN as oostershuis } from '../../shared/oostershuisPlan.ts';
import * as cathedral from '../../shared/cathedralPlan.ts';
import { housePlan, toWorld } from '../../shared/housePlan.ts';
import { CLASSES } from '../../shared/homes.ts';
const source = readFileSync(new URL('../../client/src/game/landmarks.ts', import.meta.url), 'utf8');
const literal = source.match(/const ROLES:[^=]+=(\s*\{[\s\S]*?\n\});/)[1];
const roles = Function('BIER_Z', `return (${literal});`)(33.6);
const rooms = [townhall, vleeshuis, steen, oostershuis].map(p => ({id:p.id,origin:p.origin,yaw:p.yaw,floorY:p.floorY,marks:p.marks,sets:p.sets,nodes:p.nodes,levels:p.levels,stairs:p.stairs,steps:p.steps}));
const freeRows=[];
for(let z=-8;z<=140;z+=.3){let row='';for(let x=-32;x<=32;x+=.3)row+=cathedral.freeAt(x,z,.3,false,true)?'1':'0';freeRows.push(row);}
const cathedralFloors=[];
for(let z=-8;z<=140;z+=.3){let start=null,y=0;for(let x=-32;x<=32.3;x+=.3){const free=x<=32&&cathedral.freeAt(x,z,.1,false,true),height=cathedral.floorAt(x,z);if(start!==null&&(!free||height!==y)){cathedralFloors.push({rect:{minX:start,maxX:x,minZ:z,maxZ:z+.3},y});start=null;}if(free&&start===null){start=x;y=height;}}}
rooms.push({id:'cathedral',origin:cathedral.ORIGIN,yaw:0,floorY:cathedral.FLOOR_Y,marks:cathedral.MARKS,sets:cathedral.SETS,nodes:cathedral.nodes(),levels:[],surface:cathedralFloors,freeGrid:{x:-32,z:-8,step:.3,rows:freeRows}});
const read = p => JSON.parse(readFileSync(new URL(p, import.meta.url),'utf8'));
const build=read('../../shared/city_build.json'), entries=read('../../shared/inworld_houses.json').houses;
const homes=entries.filter(e=>e.kind==='home').map(e=>{
 const p=housePlan(e,build.houses[e.house],build.ground_h??3.8,build.storey_h??3.2,CLASSES[e.cls]);
 const r=p.room.rect,spots=[];
 for(let x=r.minX+.8;x<r.maxX-.8;x+=1.2)for(let z=r.minZ+.8;z<r.maxZ-.8;z+=1.2){const [wx,wz]=toWorld(p.frame,x,z);spots.push({x:wx,z:wz,y:p.room.y});}
 return {id:e.id,door:e.door,spots,origin:p.origin,yaw:p.yaw,floorY:p.floorY,levels:p.levels,stairs:p.stairs,steps:p.steps};
});
const json=JSON.stringify({roles,rooms,homes});
writeFileSync(new URL('../../godot/src/People/HallPeopleData.cs',import.meta.url),`// Written by tools/godot/peopledata.mjs from the browser's room plans and landmark roles.
namespace Scheldemist.People;
public static class HallPeopleData
{
    public const string Json = """
${json}
""";
}
`);
console.log(`Godot people: ${rooms.length} hall plans and ${homes.length} home plans.`);
