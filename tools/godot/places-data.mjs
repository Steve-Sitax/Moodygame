// Read only public, shared plans. This does not bake or read a save.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { housePlan } from '../../shared/housePlan.ts';
import { CLASSES, FURNITURE } from '../../shared/homes.ts';
import * as TH from '../../shared/townhallPlan.ts';
import * as VH from '../../shared/vleeshuisPlan.ts';
import * as ST from '../../shared/steenPlan.ts';
import * as OH from '../../shared/oostershuisPlan.ts';
import * as P from '../../shared/cathedralPlan.ts';
import { MILLS } from '../../shared/mills.ts';
const read = file => JSON.parse(readFileSync(new URL('../../shared/' + file, import.meta.url), 'utf8'));
const build = read('city_build.json'), dormers = read('inworld_dormers.json');
const homes = read('inworld_houses.json').houses.filter(e => e.kind === 'home').map(e => {
  const p = housePlan(e, build.houses[e.house], build.ground_h, build.storey_h, CLASSES[e.cls], dormers.houses[String(e.house)]);
  return { id: e.cls, origin: p.origin, yaw: p.yaw, floor_y: p.floorY, room_frame: p.roomFrame, definition: CLASSES[e.cls] };
});
const counters = read('inworld_houses.json').houses.filter(e => e.kind === 'tavern' || e.kind === 'shop').map(e => {
  const p = housePlan(e, build.houses[e.house], build.ground_h, build.storey_h);
  const { minX: x0, maxX: x1, minZ: z0, maxZ: zHouse } = p.room.rect;
  const shop = e.kind === 'shop', z1 = shop && zHouse-z0 > 8.2 ? z0+6.6 : zHouse;
  const near = x1 < -x0 ? 1 : -1, ns = shop && Math.min(x1,-x0) < 2 ? -near : near;
  const nearW = ns > 0 ? x1 : x0, X = d => nearW-ns*d;
  const zc0=z0+(shop ? 1.45 : 2.1), zc1=shop ? Math.max(zc0+1.8,Math.min(zc0+3.4,z1-1.7)) : Math.max(zc0+2.6,Math.min(zc0+3.8,z1-2.8));
  const seats=[];
  if (!shop) {
    const style=({ 'tavern:ankere':'sailors','tavern:schipke':'sailors','tavern:vliet':'brown','tavern:engel':'grand','tavern:bassin':'coffee','tavern:linde':'brown','tavern:zwarte_kat':'sailors' })[e.id];
    const XF=d=>(ns>0?x0:x1)+ns*d, XA=(XF(2.2)+X(1.8))/2;
    const end=style==='sailors'?z1-1.5:style==='coffee'&&x1-x0>4.9?z1-3.9:style==='grand'?z1-1.4:z1-.8;
    let table=0; const put=(x,z,yaw,via,h=.47,t=table)=>seats.push({x,z,yaw,via,h,table:t});
    if(style==='sailors') { const tx=XF(1.25); for(let z=z0+1.45;z+.85<end;z+=3,table++) for(const s of [-1,1]) for(const o of [-.42,.42]) { const bx=tx+s*.72, ze=z+Math.sign(o)*1.25<z0+.6?z+1.25:z+Math.sign(o)*1.25; put(bx,z+o,Math.atan2(tx-bx,0),[[XA,ze],[bx,ze]]); } }
    else { const tx=XF(style==='grand'?.95:.85); for(let z=z0+1.2;z+.4<end;z+=1.55,table++) { const ax=tx+ns*.62; put(ax,z,Math.atan2(tx-ax,0),[[XA,z]]); if(style==='grand') {const bx=XF(.3);put(bx,z,Math.atan2(tx-bx,0),[[XA,z+.72],[bx,z+.72]]);} else put(tx,z-.6,0,[[XA,z-.6],[tx-ns*.5,z-.6]]); }
      if(x1-x0>6.2&&style==='brown') { const mx=(X(2.6)+XF(1.8))/2; for(let z=z0+3.2;z+.6<end;z+=2.4,table++) {put(mx,z-.6,0,[[mx,z-1.1]]);put(mx,z+.6,Math.PI,[[mx,z+1.1]]);} }
    }
    for(const z of zc1-zc0>3.2?[zc0+.6,(zc0+zc1)/2,zc1-.6]:[zc0+.6,zc1-.6]) put(X(1.8),z,Math.atan2(ns,0),[[XA,z]],.68,9);
  }
  return { id:e.id,kind:e.kind,origin:p.origin,yaw:p.yaw,floor_y:p.floorY+p.room.y,rect:p.room.rect,counter:{x:X(shop?1.9:1.85),z:(zc0+zc1)/2},stand:{x:X(2.6),z:(zc0+zc1)/2},seats };
});
// Read the browser's literal look prompts without constructing its Three.js halls.
const hallSource=readFileSync(new URL('../../client/src/world/landmarkHalls.ts',import.meta.url),'utf8');
const looks=[];
const contexts=[['townhall','buildTownhall',TH,{FX:TH.CHIMNEY.x,FZ:TH.CHIMNEY.z}],['vleeshuis','buildVleeshuis',VH,{X0:VH.IN.east,X1:VH.IN.west,Z0:VH.IN.south,Z1:VH.IN.north,NX:VH.SHELL.north_door_x,SX:VH.STAGE.x1,U:VH.UP,VH}],['steen','buildSteen',ST,{}],['oostershuis','buildOostershuis',OH,{}]];
for(const [hall,name,plan,more] of contexts){
  const start=hallSource.indexOf('export function '+name),next=hallSource.indexOf('export function ',start+1),chunk=hallSource.slice(start,next<0?undefined:next);
  const scope={...plan,...more,TH,VH,ST,OH};
  for(const m of chunk.matchAll(/^  looksAdd\(looks, (.*)\);$/gm)){
    const [id,x,z,r,label,text,y]=Function(...Object.keys(scope),'return ['+m[1]+'];')(...Object.values(scope));
    looks.push({hall,id,x,z,r,label,text,y:y??0});
  }
}
const cathSource=readFileSync(new URL('../../client/src/world/cathedralHall.ts',import.meta.url),'utf8');
const literal=cathSource.match(/const looks: Lookable\[\] = (\[[\s\S]*?\n  \]);/)[1];
const scope={...P,P,RS:P.RESURRECTION,XMID:(P.CROSS0+P.CROSS1)/2};
looks.push(...Function(...Object.keys(scope),'return '+literal)(...Object.values(scope)).map(l=>({hall:'cathedral',y:0,...l})));
const file = new URL('../../godot/assets/places.json', import.meta.url);
const cellarEntry=read('inworld_houses.json').houses.find(e=>e.kind==='cellar');
const cp=housePlan(cellarEntry,build.houses[cellarEntry.house],build.ground_h,build.storey_h);
const cr=cp.room.rect, bz=cr.maxZ-2, cx=(cr.minX+cr.maxX)/2;
const cellar={origin:cp.origin,yaw:cp.yaw,floor_y:cp.floorY+cp.room.y,rect:cr,foot:cp.flights[0].foot,stage:{x:cx,z:bz,feet_y:cp.floorY+cp.room.y+1.01}};
mkdirSync(new URL('../../godot/assets/', import.meta.url), { recursive: true });
writeFileSync(file, JSON.stringify({ homes, counters, cellar, looks, furniture: FURNITURE, mills: MILLS }, null, 2) + '\n');


