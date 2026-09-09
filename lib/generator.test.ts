import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, generatePlan } from './generator.ts';

test('same seed and settings reproduce geometry, rooms, and floor programs',()=>{
 assert.deepEqual(generatePlan(DEFAULT_SETTINGS),generatePlan({...DEFAULT_SETTINGS}));
 assert.notDeepEqual(generatePlan(DEFAULT_SETTINGS).vertices,generatePlan({...DEFAULT_SETTINGS,seed:'another'}).vertices);
});
test('rooms remain usable, finite, and contained across size and character extremes',()=>{
 for(const kind of ['castle','manor','house'] as const)for(const size of [48,64,88,112,120,128,192])for(const organic of [0,65,100])for(let seed=0;seed<50;seed++){
  const p=generatePlan({...DEFAULT_SETTINGS,kind,size,organic,seed:`case-${seed}`,cellar:seed%2===0,courtyard:seed%2===1});
  for(const floor of p.floors)for(const w of floor.wings)for(const r of w.rooms){
   assert.ok(Number.isFinite(r.w)&&r.w>4,`${kind}/${size}/${seed}: invalid width`);
   assert.ok(Number.isFinite(r.h)&&r.h>3,`${kind}/${size}/${seed}: invalid depth`);
   assert.ok(r.x>=0&&r.x+r.w<=w.length);
   assert.ok(r.y>=-w.depth/2&&r.y+r.h<w.depth/2);
   assert.ok(r.area>0);
   for(const v of floor.towers.flatMap(t=>t.openings))assert.ok(Number.isFinite(v));
  }
  assert.equal(p.floors.filter(f=>f.index===0).flatMap(f=>f.rooms).filter(r=>r.kind==='gate').length,1);
 }
});
test('levels have aligned stairs and distinct room uses, with optional cellar',()=>{
 const p=generatePlan({...DEFAULT_SETTINGS,floors:5,cellar:true});
 assert.equal(p.floors.length,6);
 for(const f of p.floors)assert.deepEqual(f.towers,p.floors[0].towers);
 assert.notDeepEqual(p.floors[1].rooms.map(r=>r.name),p.floors[2].rooms.map(r=>r.name));
 assert.equal(new Set(p.floors.flatMap(f=>f.rooms.map(r=>r.id))).size,p.floors.flatMap(f=>f.rooms).length);
 assert.equal(p.totalArea,p.floors.flatMap(f=>f.rooms).reduce((n,r)=>n+r.area,0));
});
test('larger builds add rooms; chapel and enclosure settings affect layout',()=>{
 for(const kind of ['castle','manor','house'] as const){
  const a=generatePlan({...DEFAULT_SETTINGS,kind,size:48}),b=generatePlan({...DEFAULT_SETTINGS,kind,size:192});
  assert.ok(b.width>a.width);assert.ok(b.floors[0].rooms.length>a.floors[0].rooms.length);
 }
 assert.ok(generatePlan(DEFAULT_SETTINGS).floors[0].rooms.some(r=>r.kind==='sacred'));
 assert.ok(generatePlan({...DEFAULT_SETTINGS,chapel:false}).floors[0].rooms.every(r=>r.kind!=='sacred'));
 assert.equal(generatePlan({...DEFAULT_SETTINGS,courtyard:false}).floors[0].wings.length,6);
});
