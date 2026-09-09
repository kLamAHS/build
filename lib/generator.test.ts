import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatePlan, tryGenerate } from './architecture.ts';
import { DEFAULT_SETTINGS, FAMILIES, insidePolygon, type Settings, type Plan } from './model.ts';
import { voxelize, prepareMeshes, SparseBlocks } from './voxels.ts';
import { accessGraph, transitViolations, isCirculation, routeToRoom, navigationReport, articulationPoints } from './navigation.ts';

export const representatives:Settings[]=(['house','manor','castle'] as const).flatMap(kind=>[128,256].flatMap(size=>[0,1,2].map(i=>({...DEFAULT_SETTINGS,kind,size,seed:`REVIEW-${kind}-${size}-${i}`,family:FAMILIES[kind][i].id}))));
const reference=generatePlan(DEFAULT_SETTINGS);
function audit(p:Plan){
  assert.equal(p.validation.valid,true,p.validation.issues.join('; '));
  assert.equal(p.rooms.filter(r=>r.kind==='hall').length,1);
  assert.ok(p.rooms.some(r=>r.name.includes('Kitchen'))||p.rooms.some(r=>r.name==='Workshop'));
  const grid=voxelize(p);
  for(const door of p.openings.filter(o=>o.type!=='window')){
    for(let w=0;w<door.width;w++)for(let h=0;h<door.height;h++){
      const x=door.x+(door.axis==='z'?w:0),z=door.z+(door.axis==='x'?w:0);
      assert.equal(grid.material(x,door.y+h,z),0,`${p.settings.seed} blocked door ${door.id} (${x},${door.y+h},${z})`);
    }
    if(door.type==='door'){
      const rooms=door.roomIds.map(id=>p.rooms.find(r=>r.id===id)!);
      for(const r of rooms){const b=r.bounds;assert.ok(door.axis==='x'?(door.x===b.x||door.x===b.x+b.w):(door.z===b.z||door.z===b.z+b.d),`${door.id} is not on a shared wall`);}
    }
  }
  for(const st of p.stairs){
    assert.equal(st.toY-st.fromY,6);assert.equal(st.width,2);assert.ok(st.landings.every(l=>l.w>=2&&l.d>=2));
    for(let j=0;j<6;j++)for(let w=0;w<2;w++){
      const x=st.bounds.x+3+w,z=st.bounds.z+3+j,y=st.fromY+j+1;
      assert.ok(grid.material(x,y,z),`Missing tread ${st.id}`);
      for(let h=1;h<=3;h++)assert.equal(grid.material(x,y+h,z),0,`${p.settings.seed}: blocked headroom ${st.id} at ${x},${y+h},${z}`);
    }
    for(const l of st.landings)for(let x=l.x;x<l.x+l.w;x++)for(let z=l.z;z<l.z+l.d;z++){
      const y=l===st.landings[0]?st.fromY:st.toY;assert.ok(grid.material(x,y,z),`Landing not supported ${st.id}`);
    }
  }
  for(const chimney of p.chimneys){for(let y=chimney.fromY;y<chimney.toY;y++)for(let x=chimney.bounds.x;x<chimney.bounds.x+chimney.bounds.w;x++)for(let z=chimney.bounds.z;z<chimney.bounds.z+chimney.bounds.d;z++)assert.equal(grid.material(x,y,z),8,'Broken chimney stack');}
  const hall=p.rooms.find(r=>r.kind==='hall')!;
  for(let y=6;y<hall.ceilingY;y+=6){const b=hall.bounds;for(let x=b.x+2;x<b.x+b.w-1;x++)for(let z=b.z+2;z<b.z+b.d-1;z++){if(p.rooms.some(r=>r.kind==='gallery'&&r.floorY===y&&insidePolygon(x+.5,z+.5,r.polygon)))continue;assert.equal(grid.material(x,y,z),0,`Tall hall filled at Y ${y}`);}}
  for(const r of p.rooms.filter(r=>r.floorY>0&&r.kind!=='gallery')){
    const c=p.components.find(c=>c.id===r.componentId)!;
    assert.ok(r.floorY<c.topY&&c.baseY<r.floorY);
    assert.ok(p.supports.some(b=>b.componentId===c.id&&b.y===r.floorY-1),`${r.name} lacks a supporting structure`);
  }
  const graph=accessGraph(p);
  assert.equal(graph.unreachable.length,0,`${p.settings.seed}: ${graph.unreachable.length} rooms have no route from the entrance`);
  const forced=transitViolations(p,graph);
  assert.deepEqual(forced.map(t=>`${t.name} strands ${t.strands.length}`),[],`${p.settings.seed}: a household is forced to cross these rooms`);
  for(const r of p.rooms.filter(r=>!isCirculation(r))){
    const doors=p.connections.filter(e=>e.includes(r.id)).map(([a,b])=>p.rooms.find(x=>x.id===(a===r.id?b:a))!);
    assert.ok(doors.some(isCirculation),`${p.settings.seed}: ${r.name} has no door onto circulation`);
  }
  assert.ok(p.navigation.loops>=1,`${p.settings.seed}: the doors form a bare tree with only one route to everywhere`);
  // The chapel is entered from its antechapel or a passage, never from a kitchen, a store or a bedchamber.
  for(const [a,b] of p.connections){
    const [m,n]=[a,b].map(id=>p.rooms.find(r=>r.id===id)!);
    if(!m||!n)continue;
    const kinds=[m.kind,n.kind];
    if(kinds.includes('sacred'))assert.ok(kinds.every(k=>k==='sacred'||['circulation','stairs','gallery','hall'].includes(k)),`${p.settings.seed}: a door joins ${m.name} to ${n.name}`);
    assert.ok(!(kinds.includes('bedroom')&&(kinds.includes('service')||kinds.includes('hall'))),`${p.settings.seed}: a door joins ${m.name} to ${n.name}`);
  }
  for(const f of p.floors){
    const layer=grid.layer(f.elevation+2);let count=0;
    for(const run of layer.runs)for(let x=run.x;x<run.x+run.length;x++){assert.equal(grid.material(x,layer.y,run.z),run.material);count++;}
    assert.equal(count,Object.values(layer.counts).reduce((n,c)=>n+c,0));
  }
  return grid;
}
test('permanent manor: a tall hall, three occupied domestic levels, service end and gallery',()=>{
  assert.equal(reference.name,'Alderhall Manor');assert.ok(reference.components.some(c=>c.kind==='domestic'&&c.storeys===3));
  assert.ok(reference.rooms.some(r=>r.kind==='gallery'&&r.floorY===6));assert.ok(reference.floors.find(f=>f.elevation===12)!.voids.length);
  assert.ok(reference.components.some(c=>c.baseY===0)&&reference.components.some(c=>c.baseY===-6));audit(reference);
});
test('18 medium and large representatives have coherent architecture and matching block geometry',()=>{for(const settings of representatives)audit(generatePlan(settings));});
test('bounded failures report conflicts instead of emitting invalid buildings',()=>{
  assert.equal(tryGenerate({...DEFAULT_SETTINGS,size:513}).ok,false);assert.equal(tryGenerate({...DEFAULT_SETTINGS,floors:9}).ok,false);assert.equal(tryGenerate({...DEFAULT_SETTINGS,kind:'house',family:'palace'}).ok,false);
});
test('seed and version determinism, including semantic and voxel operations',()=>{assert.deepEqual(generatePlan(DEFAULT_SETTINGS),reference);assert.equal(reference.schemaVersion,2);assert.equal(reference.generatorVersion,'2.0');});
test('upper floors change partitions, footprints, occupancy and voids',()=>{
  const c=reference.components.find(c=>c.kind==='domestic')!;
  const levels=[0,6,12].map(y=>reference.rooms.filter(r=>r.componentId===c.id&&r.floorY===y));
  assert.notDeepEqual(levels[0].map(r=>r.bounds),levels[1].map(r=>r.bounds));assert.notDeepEqual(levels[1].map(r=>r.bounds),levels[2].map(r=>r.bounds));
  const grid=voxelize(reference),hall=reference.rooms.find(r=>r.kind==='hall')!,x=hall.bounds.x+8,z=hall.bounds.z+8;assert.ok(grid.material(x,0,z));assert.equal(grid.material(x,6,z),0);
});
test('families and seeds vary component graph and proportions beyond rotations or translations',()=>{
  const signatures=new Set<string>(),graphs=new Set<string>();
  for(const kind of ['castle','manor','house'] as const)for(const family of FAMILIES[kind])for(let i=0;i<4;i++){
    const p=generatePlan({...DEFAULT_SETTINGS,kind,family:family.id,seed:`VARIETY-${i}`,size:160});
    signatures.add(JSON.stringify(p.components.map(c=>[c.kind,c.bounds.w,c.bounds.d,c.storeys,c.parentId])));
    graphs.add(JSON.stringify(p.components.map(c=>[c.kind,c.parentId])));
  }
  assert.ok(signatures.size>=38,`Only ${signatures.size} distinct compositions`);assert.ok(graphs.size>=15,`Only ${graphs.size} connection graphs`);
});
test('compact, maximum storeys and a 512-block site remain sparse and navigable',()=>{
  for(const kind of ['house','manor','castle'] as const)audit(generatePlan({...DEFAULT_SETTINGS,kind,family:'auto',size:48,floors:1,cellar:false,seed:'COMPACT'}));
  const start=performance.now(),p=generatePlan({...DEFAULT_SETTINGS,kind:'castle',family:'double-ward',size:512,floors:8,seed:'LARGEST-512'}),grid=audit(p),meshes=prepareMeshes(grid);
  assert.ok(p.width<=512&&p.depth<=512);assert.equal(Math.max(...p.rooms.map(r=>r.floorY)),42);assert.ok(grid.stats().bytes<32*1024*1024);assert.ok(meshes.length<240);assert.ok(performance.now()-start<10000,'Largest build exceeded ten seconds');
  assert.ok(meshes.reduce((n,m)=>n+m.indices.length/3,0)<grid.stats().blocks*8);
});
test('greedy exposed faces and layers come from exactly the same occupied cells',()=>{
  const grid=new SparseBlocks({x:-16,z:-16,w:48,d:48});grid.apply({x:-1,y:0,z:-1,w:3,d:4,h:2,material:1,kind:'wall',componentId:'test'});grid.apply({x:0,y:0,z:0,w:1,d:1,h:2,material:0,kind:'air',componentId:'test'});
  const mesh=prepareMeshes(grid);let surface=0;
  for(const m of mesh)for(let i=0;i<m.indices.length;i+=3){const points=[0,1,2].map(k=>{const a=m.indices[i+k]*3;return [m.positions[a],m.positions[a+1],m.positions[a+2]];});const a=points[1].map((n,j)=>n-points[0][j]),b=points[2].map((n,j)=>n-points[0][j]);surface+=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2;}
  let faces=0;for(let x=-1;x<2;x++)for(let z=-1;z<3;z++)for(let y=0;y<2;y++)if(grid.material(x,y,z))for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])if(!grid.material(x+dx,y+dy,z+dz))faces++;
  assert.equal(surface,faces);assert.equal(grid.layer(0).counts[1],11);assert.equal(grid.material(0,0,0),0);
});
test('a chapel is never reached through the kitchens, and no chamber is a corridor',()=>{
  // The reported defect: the only door into the chapel opened off the kitchen, so the household walked
  // Entrance -> Screens passage -> Great hall -> Cross passage -> Kitchen -> Chapel to reach the altar.
  const chapel=reference.rooms.find(r=>r.kind==='sacred')!;
  const route=routeToRoom(reference,chapel.id);
  assert.ok(route.length>1,'the chapel has no route from the entrance');
  assert.deepEqual(route.slice(0,-1).filter(r=>!isCirculation(r)).map(r=>r.name),[],`route to the chapel: ${route.map(r=>r.name).join(' -> ')}`);
  const approach=route[route.length-2];
  assert.ok(approach.kind==='circulation'||approach.kind==='hall',`the chapel is entered from ${approach.name}`);
  for(const settings of representatives){
    const p=generatePlan(settings);
    for(const sacred of p.rooms.filter(r=>r.kind==='sacred')){
      const crossed=routeToRoom(p,sacred.id).slice(0,-1).filter(r=>!isCirculation(r));
      assert.deepEqual(crossed.map(r=>r.name),[],`${settings.seed}: the chapel is reached through ${crossed.map(r=>r.name).join(', ')}`);
    }
  }
});
test('every family and size walks well: no forced crossings, real alternative routes, shallow reach',()=>{
  const reports=[];
  for(const kind of ['house','manor','castle'] as const)for(const family of FAMILIES[kind])for(const size of [96,160,256]){
    const p=generatePlan({...DEFAULT_SETTINGS,kind,family:family.id,size,floors:3,seed:`WALK-${size}`});
    const nav=navigationReport(p);
    assert.deepEqual(nav.transits.map(t=>t.name),[],`${kind}/${family.id}/${size}: forced to cross ${nav.transits.map(t=>t.name).join(', ')}`);
    assert.equal(nav.unreachable.length,0,`${kind}/${family.id}/${size}: unreachable rooms`);
    assert.ok(nav.loops>=1,`${kind}/${family.id}/${size}: the doors form a bare tree`);
    assert.deepEqual(nav,p.navigation,'the plan carries the same report the module computes');
    reports.push(nav);
  }
  const mean=reports.reduce((n,r)=>n+r.score,0)/reports.length;
  assert.ok(mean>=80,`mean navigability ${mean.toFixed(1)} is below the 80 this generator is expected to hold`);
});
test('every family builds across the size and storey range, including chamfered towers',()=>{
  // A passage hugging a tower's wall pinched below two walkable blocks where the chamfer cuts the corner,
  // which the voxel audit rejected and which no reroll could recover.
  const failures:string[]=[];
  for(const kind of ['house','manor','castle'] as const)for(const family of FAMILIES[kind])
  for(const size of [64,160,320,512])for(const floors of [1,4,8]){
    const settings={...DEFAULT_SETTINGS,kind,family:family.id,size,floors,seed:`BUILDABLE-${floors}`};
    const result=tryGenerate(settings);
    if(!result.ok)failures.push(`${kind}/${family.id}/${size}/${floors}: ${result.error}`);
    else assert.equal(result.plan.navigation.unreachable.length,0,`${kind}/${family.id}/${size}/${floors}: unreachable rooms`);
  }
  assert.deepEqual(failures,[]);
});
/** Would closing one of this room's doors part the plan or force a household through somewhere private? */
function loadBearing(p:Plan,roomId:string){
  const doors=p.connections.filter(e=>e.includes(roomId));
  return doors.some(([a,b])=>{
    const adjacency=new Map(p.rooms.map(r=>[r.id,[] as string[]]));
    for(const [m,n] of p.connections){if(m===a&&n===b)continue;adjacency.get(m)?.push(n);adjacency.get(n)?.push(m);}
    const entry=p.openings.find(o=>o.type==='entrance')!.roomIds[0];
    const seen=new Set([entry]),queue=[entry];
    for(let i=0;i<queue.length;i++)for(const next of adjacency.get(queue[i])!)if(!seen.has(next)){seen.add(next);queue.push(next);}
    if(seen.size<p.rooms.length)return true;
    const byId=new Map(p.rooms.map(r=>[r.id,r]));
    return [...articulationPoints({adjacency,depth:new Map(),entry,unreachable:[]}).keys()].some(id=>{const r=byId.get(id);return r&&!isCirculation(r);});
  });
}
test('chambers are furnished, lit and private: a bed to sleep in and no second way through',()=>{
  // Regressions caught after the circulation work: a fixed 3x4 bed and a door clearance reaching seven
  // blocks through the wall left 27% of bedchambers empty, and extra doors turned 16% into shortcuts.
  let bedrooms=0,bare=0,shortcuts=0,windowless=0,landlocked=0;
  for(const settings of representatives){
    const p=generatePlan(settings);
    const byId=new Map(p.rooms.map(r=>[r.id,r]));
    const lit=new Set(p.openings.filter(o=>o.type==='window').flatMap(o=>o.roomIds));
    for(const room of p.rooms){
      if(room.kind==='bedroom'){
        bedrooms++;
        if(!room.furniture.some(f=>f.type==='bed'))bare++;
        const onto=p.connections.filter(e=>e.includes(room.id)).map(([a,b])=>byId.get(a===room.id?b:a)!).filter(isCirculation);
        if(onto.length>1&&!loadBearing(p,room.id))shortcuts++;
      }
      if(isCirculation(room)||room.floorY<0||lit.has(room.id))continue;
      windowless++;
      // A room with no outside face cannot have a window; that is a massing question, not a window one.
      const b=room.bounds,outside=(x:number,z:number)=>!p.rooms.some(o=>o.floorY<=room.floorY&&o.ceilingY>room.floorY&&insidePolygon(x,z,o.polygon));
      const hasFace=[[b.x-.5,b.z+1.5],[b.x+b.w+.5,b.z+1.5],[b.x+1.5,b.z-.5],[b.x+1.5,b.z+b.d+.5]].some(([x,z])=>outside(x,z));
      if(!hasFace)landlocked++;
    }
  }
  assert.ok(bare/bedrooms<=0.03,`${bare} of ${bedrooms} bedchambers have no bed`);
  assert.equal(shortcuts,0,`${shortcuts} bedchambers have a second door onto circulation that nothing needed`);
  assert.ok((windowless-landlocked)/Math.max(1,windowless)<=0.5,`${windowless-landlocked} of ${windowless} windowless chambers do have an outside wall`);
});
