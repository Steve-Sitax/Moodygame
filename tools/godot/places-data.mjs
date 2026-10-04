// Read only public, shared plans. This does not bake or read a save.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { housePlan } from '../../shared/housePlan.ts';
import { CLASSES, FURNITURE } from '../../shared/homes.ts';
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
  return { id:e.id,kind:e.kind,origin:p.origin,yaw:p.yaw,floor_y:p.floorY+p.room.y,rect:p.room.rect,counter:{x:X(shop?1.9:1.85),z:(zc0+zc1)/2},stand:{x:X(2.6),z:(zc0+zc1)/2} };
});
const file = new URL('../../godot/assets/places.json', import.meta.url);
mkdirSync(new URL('../../godot/assets/', import.meta.url), { recursive: true });
writeFileSync(file, JSON.stringify({ homes, counters, furniture: FURNITURE, mills: MILLS }, null, 2) + '\n');
