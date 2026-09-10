import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candidateCount, generateCandidate, generatePlan, rank, tryGenerate } from './architecture.ts';
import { bayLines, compositionReport } from './composition.ts';
import { DEFAULT_SETTINGS, FAMILIES, insidePolygon, intersects, type Settings, type Plan, type Rect } from './model.ts';
import { voxelize, prepareMeshes, SparseBlocks } from './voxels.ts';
import { auditArchitecture } from './architectural-audit.ts';
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
      for(const r of rooms){
        const outline=new Set<string>();
        for(let i=0;i<r.polygon.length;i++){
          const v=r.polygon[i],w=r.polygon[(i+1)%r.polygon.length];
          const steps=Math.max(Math.abs(w.x-v.x),Math.abs(w.z-v.z));
          for(let k=0;k<=steps;k++){
            const t=steps?k/steps:0;
            outline.add(`${Math.round(v.x+(w.x-v.x)*t)},${Math.round(v.z+(w.z-v.z)*t)}`);
          }
        }
        for(let k=0;k<door.width;k++){
          const cell=door.axis==='x'?`${door.x},${door.z+k}`:`${door.x+k},${door.z}`;
          assert.ok(outline.has(cell),`${door.id} is not on a wall of ${r.name}`);
        }
      }
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
  const inSuite=new Map(p.suites.flatMap(u=>u.roomIds.filter(id=>id!==u.headId).map(id=>[id,u] as const)));
  for(const r of p.rooms.filter(r=>!isCirculation(r))){
    const doors=p.connections.filter(e=>e.includes(r.id)).map(([a,b])=>p.rooms.find(x=>x.id===(a===r.id?b:a))!);
    const suite=inSuite.get(r.id);
    if(suite){assert.ok(doors.some(d=>d.id===suite.headId),`${p.settings.seed}: ${r.name} is not entered from ${suite.name}`);continue;}
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
void test('permanent manor: a tall hall, three occupied domestic levels, service end and gallery',()=>{
  assert.equal(reference.name,'Alderhall Manor');assert.ok(reference.components.some(c=>c.kind==='domestic'&&c.storeys===3));
  assert.ok(reference.rooms.some(r=>r.kind==='gallery'&&r.floorY===6));assert.ok(reference.floors.find(f=>f.elevation===12)!.voids.length);
  assert.ok(reference.components.some(c=>c.baseY===0)&&reference.components.some(c=>c.baseY===-6));audit(reference);
});
void test('18 medium and large representatives have coherent architecture and matching block geometry',()=>{for(const settings of representatives)audit(generatePlan(settings));});
void test('bounded failures report conflicts instead of emitting invalid buildings',()=>{
  assert.equal(tryGenerate({...DEFAULT_SETTINGS,size:513}).ok,false);assert.equal(tryGenerate({...DEFAULT_SETTINGS,floors:9}).ok,false);assert.equal(tryGenerate({...DEFAULT_SETTINGS,kind:'house',family:'palace'}).ok,false);
});
void test('seed and version determinism, including semantic and voxel operations',()=>{assert.deepEqual(generatePlan(DEFAULT_SETTINGS),reference);assert.equal(reference.schemaVersion,2);assert.equal(reference.generatorVersion,'2.0');});
void test('upper floors change partitions, footprints, occupancy and voids',()=>{
  const c=reference.components.find(c=>c.kind==='domestic')!;
  const levels=[0,6,12].map(y=>reference.rooms.filter(r=>r.componentId===c.id&&r.floorY===y));
  assert.notDeepEqual(levels[0].map(r=>r.bounds),levels[1].map(r=>r.bounds));assert.notDeepEqual(levels[1].map(r=>r.bounds),levels[2].map(r=>r.bounds));
  const grid=voxelize(reference),hall=reference.rooms.find(r=>r.kind==='hall')!,x=hall.bounds.x+8,z=hall.bounds.z+8;assert.ok(grid.material(x,0,z));assert.equal(grid.material(x,6,z),0);
});
void test('families and seeds vary component graph and proportions beyond rotations or translations',()=>{
  const signatures=new Set<string>(),graphs=new Set<string>();
  for(const kind of ['castle','manor','house'] as const)for(const family of FAMILIES[kind])for(let i=0;i<4;i++){
    const p=generatePlan({...DEFAULT_SETTINGS,kind,family:family.id,seed:`VARIETY-${i}`,size:160});
    signatures.add(JSON.stringify(p.components.map(c=>[c.kind,c.bounds.w,c.bounds.d,c.storeys,c.parentId])));
    graphs.add(JSON.stringify(p.components.map(c=>[c.kind,c.parentId])));
  }
  assert.ok(signatures.size>=38,`Only ${signatures.size} distinct compositions`);assert.ok(graphs.size>=15,`Only ${graphs.size} connection graphs`);
});
void test('compact, maximum storeys and a 512-block site remain sparse and navigable',()=>{
  for(const kind of ['house','manor','castle'] as const)audit(generatePlan({...DEFAULT_SETTINGS,kind,family:'auto',size:48,floors:1,cellar:false,seed:'COMPACT'}));
  const start=performance.now(),p=generatePlan({...DEFAULT_SETTINGS,kind:'castle',family:'double-ward',size:512,floors:8,seed:'LARGEST-512'}),grid=audit(p),meshes=prepareMeshes(grid);
  assert.ok(p.width<=512&&p.depth<=512);assert.equal(Math.max(...p.rooms.map(r=>r.floorY)),42);assert.ok(grid.stats().bytes<32*1024*1024);assert.ok(meshes.length<240);assert.ok(performance.now()-start<10000,'Largest build exceeded ten seconds');
  assert.ok(meshes.reduce((n,m)=>n+m.indices.length/3,0)<grid.stats().blocks*8);
});
void test('greedy exposed faces and layers come from exactly the same occupied cells',()=>{
  const grid=new SparseBlocks({x:-16,z:-16,w:48,d:48});grid.apply({x:-1,y:0,z:-1,w:3,d:4,h:2,material:1,kind:'wall',componentId:'test'});grid.apply({x:0,y:0,z:0,w:1,d:1,h:2,material:0,kind:'air',componentId:'test'});
  const mesh=prepareMeshes(grid);let surface=0;
  for(const m of mesh)for(let i=0;i<m.indices.length;i+=3){const points=[0,1,2].map(k=>{const a=m.indices[i+k]*3;return [m.positions[a],m.positions[a+1],m.positions[a+2]];});const a=points[1].map((n,j)=>n-points[0][j]),b=points[2].map((n,j)=>n-points[0][j]);surface+=Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])/2;}
  let faces=0;for(let x=-1;x<2;x++)for(let z=-1;z<3;z++)for(let y=0;y<2;y++)if(grid.material(x,y,z))for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])if(!grid.material(x+dx,y+dy,z+dz))faces++;
  assert.equal(surface,faces);assert.equal(grid.layer(0).counts[1],11);assert.equal(grid.material(0,0,0),0);
});
void test('a chapel is never reached through the kitchens, and no chamber is a corridor',()=>{
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
void test('every family and size walks well: no forced crossings, real alternative routes, shallow reach',()=>{
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
void test('every family builds across the size and storey range, including chamfered towers',()=>{
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
void test('chambers are furnished, lit and private: a bed to sleep in and no second way through',()=>{
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
void test('rooms have shape and scale, not a grid of equal boxes',()=>{
  // The complaint this answers: "a collection of hallways and rectangle rooms packed together".
  let shaped=0,rooms=0;const ratios:number[]=[];
  for(const settings of representatives){
    const p=generatePlan(settings);
    for(const r of p.rooms){
      rooms++;
      if(r.polygon.length>4)shaped++;
      // Whatever its shape, a room keeps a straight run of wall long enough to take a door.
      const b=r.bounds;
      assert.ok(b.w>=4&&b.d>=4,`${settings.seed}: ${r.name} is ${b.w}x${b.d}`);
    }
    const byRange=new Map<string,number[]>();
    for(const r of p.rooms){
      if(isCirculation(r))continue;
      const key=`${r.componentId}:${r.floorY}`;
      byRange.set(key,[...(byRange.get(key)??[]),r.area]);
    }
    for(const areas of byRange.values())if(areas.length>1)ratios.push(Math.max(...areas)/Math.min(...areas));
  }
  const shapedShare=shaped/rooms,hierarchy=ratios.reduce((a,b)=>a+b,0)/ratios.length;
  assert.ok(shapedShare>=0.05,`only ${(shapedShare*100).toFixed(1)}% of rooms are anything but a rectangle`);
  assert.ok(hierarchy>=3,`the largest room in a range is only ${hierarchy.toFixed(1)}x the smallest`);
  // The two rooms whose shape carries meaning.
  const hall=reference.rooms.find(r=>r.kind==='hall')!;
  assert.ok(hall.polygon.length>4,'the great hall has no dais end');
  const chapel=reference.rooms.find(r=>r.kind==='sacred')!;
  assert.ok(chapel.polygon.length>8,'the chapel has no apse');
});
void test('ordinary rooms keep their proportions: no strip a wing long, nothing that has eaten its range',()=>{
  // The complaint this answers: a solar, a pantry and a household dining room each drawn as a band the
  // length of the wing, because a minimum area is satisfied by a strip and a target with no ceiling is
  // satisfied by whatever is left over. Every ordinary room now has an upper bound on both.
  const ORDINARY=['bedroom','study','service','storage'];
  let counted=0,worstShape=0,worstSize=0,shape='',size='';
  for(const kind of ['house','manor','castle'] as const)for(const family of FAMILIES[kind])for(const budget of [96,192,384]){
    const p=generatePlan({...DEFAULT_SETTINGS,kind,family:family.id,size:budget,floors:3,seed:`FIT-${budget}`});
    for(const r of p.rooms){
      if(!ORDINARY.includes(r.kind))continue;
      counted++;
      const w=r.bounds.w-1,d=r.bounds.d-1,aspect=Math.max(w,d)/Math.min(w,d);
      if(aspect>worstShape){worstShape=aspect;shape=`${r.name} ${w}x${d} (${family.id}/${budget})`;}
      if(w*d>worstSize){worstSize=w*d;size=`${r.name} ${w}x${d} (${family.id}/${budget})`;}
    }
  }
  assert.ok(counted>500,`only ${counted} ordinary rooms surveyed`);
  assert.ok(worstShape<=3.2,`the longest ordinary room is ${worstShape.toFixed(1)} times its width: ${shape}`);
  assert.ok(worstSize<=760,`the largest ordinary room has taken ${worstSize} blocks: ${size}`);
});
void test('an upper storey is accommodation of its own, and a stair comes up into a well that is drawn',()=>{
  // The defect this answers: every floor above the ground one filled with bedchambers and wardrobes whatever
  // the range was for, and the hole a stair comes up through left as an unexplained grey gap in the boards.
  const names=new Map<string,number>();let rooms=0;
  for(const kind of ['manor','castle','house'] as const)for(const family of FAMILIES[kind])for(const size of [128,256]){
    const p=generatePlan({...DEFAULT_SETTINGS,kind,family:family.id,size,floors:4,seed:'ABOVE'});
    for(const st of p.stairs){
      const above=p.floors.find(f=>f.elevation===st.toY);
      assert.ok(above?.voids.some(v=>v.id===`well-${st.id}`),`${family.id}/${size}: ${st.id} comes up into a floor with no well drawn`);
    }
    // A door onto a well is a fall, and the audit rejects it; every plan returned has already passed that.
    assert.deepEqual(auditArchitecture(p),[],`${family.id}/${size}: the plan returned does not pass its own audit`);
    for(const r of p.rooms){
      if(r.floorY<=0||isCirculation(r))continue;
      rooms++;const base=r.name.replace(/ \d+$/,'');names.set(base,(names.get(base)??0)+1);
    }
  }
  assert.ok(rooms>300,`only ${rooms} rooms above the ground floor surveyed`);
  assert.ok(names.size>=24,`only ${names.size} kinds of room above the ground floor`);
  const commonest=Math.max(...names.values());
  assert.ok(commonest/rooms<=0.15,`${(100*commonest/rooms).toFixed(0)}% of the rooms above ground are the same room`);
});
void test('a wall is divided into bays before anything is cut into it',()=>{
  // The defect this answers: one window every seven blocks from each room's own corner, the same size for a
  // pantry as for a great hall, and an upper storey whose lights fell wherever that floor's rooms divided.
  let windows=0,upper=0,over=0;const forms=new Set<string>();
  for(const settings of representatives){
    const p=generatePlan(settings);
    const byId=new Map(p.rooms.map(r=>[r.id,r]));
    const doors=new Set(p.openings.filter(o=>o.type!=='window').flatMap(o=>
      Array.from({length:o.width},(_,w)=>`${o.x+(o.axis==='z'?w:0)},${o.z+(o.axis==='x'?w:0)}`)));
    const bays=new Map<string,number[]>();
    // A light in a projection stands in the bay's own wall, not in the room's, so the pier rule is not its rule.
    const projected=(o:{x:number;z:number;width:number;axis:string})=>p.articulation.some(a=>a.role!=='niche'
      &&Array.from({length:o.width},(_,w)=>({x:o.x+(o.axis==='z'?w:0),z:o.z+(o.axis==='x'?w:0)}))
        .some(k=>k.x>=a.bounds.x-1&&k.x<=a.bounds.x+a.bounds.w+1&&k.z>=a.bounds.z-1&&k.z<=a.bounds.z+a.bounds.d+1));
    for(const o of p.openings.filter(o=>o.type==='window')){
      windows++;forms.add(`${o.width}x${o.height}`);
      if(projected(o))continue;
      const room=byId.get(o.roomIds[0])!;
      const across=o.axis==='z';
      // A pier either side: the wall cell beyond each end of the light belongs to the same room behind it.
      for(let w=-1;w<=o.width;w++){
        const x=across?o.x+w:o.x,z=across?o.z:o.z+w;
        const inside=across?{x:x+.5,z:z+(z===room.bounds.z?1.5:-.5)}:{x:x+(x===room.bounds.x?1.5:-.5),z:z+.5};
        assert.ok(insidePolygon(inside.x,inside.z,room.polygon),`${settings.seed}: ${room.name} has a light with no pier beside it`);
      }
      for(let w=0;w<o.width;w++)assert.ok(!doors.has(`${o.x+(across?w:0)},${o.z+(across?0:w)}`),`${settings.seed}: a light is cut through a doorway`);
      // Nothing is cut through a hearth mass.
      const mass={x:o.x-1,z:o.z-1,w:(across?o.width:1)+2,d:(across?1:o.width)+2};
      for(const fu of room.furniture)if(fu.type==='hearth'||fu.type==='oven')
        assert.ok(!intersects(fu,mass),`${settings.seed}: a light is cut through the ${fu.type} in ${room.name}`);
      // Bays are lines on the range's wall, so a light on one storey stands over the light below it.
      const c=p.components.find(x=>x.id===room.componentId)!;
      const along=(across?o.x:o.z)+Math.floor(o.width/2);
      const near=across?o.z<c.bounds.z+c.bounds.d/2:o.x<c.bounds.x+c.bounds.w/2;
      const key=`${room.componentId}:${o.axis}:${near?'lo':'hi'}:${along}`;
      bays.set(key,[...(bays.get(key)??[]),room.floorY]);
    }
    for(const [key,levels] of bays)for(const y of levels)if(y>0){upper++;if(levels.some(other=>other<y))over++;void key;}
  }
  assert.ok(windows>500,`only ${windows} lights across the standard set`);
  assert.ok(forms.size>=3,`every light is the same shape: ${[...forms].join(', ')}`);
  assert.ok(over/Math.max(1,upper)>=0.55,`only ${over} of ${upper} upper lights stand over one below`);
});
void test('candidates are ranked on how they stand as well as on how they walk',()=>{
  // The ranker used to return the first candidate with no forced crossing, whatever it looked like, so a
  // composition strung out in a chain of sheds was accepted as readily as a building.
  const seeds=[0,1,2,3].flatMap(i=>(['manor','castle'] as const).map(kind=>({...DEFAULT_SETTINGS,kind,family:'auto' as const,size:288,floors:3,seed:`RANK-${i}`})));
  for(const settings of seeds){
    const chosen=generatePlan(settings);
    assert.deepEqual(chosen.composition,compositionReport(chosen),'the plan carries the report the module computes');
    // Whatever the seed allows, the plan returned is the best of them by the generator's own ranking.
    const others=Array.from({length:candidateCount(settings)},(_,a)=>{try{return generateCandidate(settings,a);}catch{return undefined;}})
      .filter((p):p is Plan=>!!p&&p.validation.valid&&!auditArchitecture(p).length);
    const better=others.filter(p=>rank(p)>rank(chosen));
    assert.deepEqual(better.map(p=>`${p.navigation.score}/${p.composition.score}`),[],
      `${settings.seed}: a better candidate than ${chosen.navigation.score}/${chosen.composition.score} was passed over`);
  }
  // A composition is a building rather than a chain: nothing is many volumes deep from the hall.
  let deep=0,plans=0;
  for(const kind of ['manor','castle','house'] as const)for(const family of FAMILIES[kind])for(const size of [160,288]){
    const p=generatePlan({...DEFAULT_SETTINGS,kind,family:family.id,size,floors:3,seed:'STAND'});
    plans++;
    assert.ok(p.composition.volumes>=2,`${family.id}/${size}: ${p.composition.volumes} volumes`);
    assert.ok(p.composition.frontage>=0.75,`${family.id}/${size}: only ${(p.composition.frontage*100).toFixed(0)}% of rooms have an outside wall`);
    if(p.composition.reach>5)deep++;
  }
  assert.ok(deep/plans<=0.15,`${deep} of ${plans} compositions straggle more than five volumes from the hall`);
});
void test('the estate composes its open space, and each volume takes its shape from what it houses',()=>{
  // The defect this answers: every addition drawn as a rectangle of much the same proportions, attached to
  // a random parent on a random side, with the only outdoor space whatever was left inside the curtain wall.
  const touches=(a:Rect,b:Rect)=>{
    const lapZ=Math.min(a.z+a.d,b.z+b.d)-Math.max(a.z,b.z),lapX=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
    return (lapZ>0&&(a.x+a.w===b.x||b.x+b.w===a.x))||(lapX>0&&(a.z+a.d===b.z||b.z+b.d===a.z));
  };
  let plans=0,withYard=0,lodging=0,longRanges=0,towers=0,compact=0;
  const programmes=new Set<string>();
  for(const kind of ['manor','castle','house'] as const)for(const family of FAMILIES[kind])for(let i=0;i<6;i++){
    const p=generatePlan({...DEFAULT_SETTINGS,kind,family:family.id,size:224,floors:3,seed:`COMPOSE-${i}`});
    plans++;
    programmes.add(JSON.stringify(p.components.map(c=>`${c.kind}:${Math.min(3,c.storeys)}`).sort()));
    const yards=p.components.filter(c=>c.kind==='court');
    if(yards.length)withYard++;
    for(const yard of yards){
      // An open space is part of the composition, which means buildings address it and it is a way through.
      const walls=p.components.filter(o=>o.id!==yard.id&&touches(yard.bounds,o.bounds)).length;
      assert.ok(walls>=2,`${family.id}/${i}: ${yard.name} is addressed by ${walls} buildings`);
      const room=p.rooms.find(r=>r.componentId===yard.id)!;
      const doors=p.connections.filter(e=>e.includes(room.id)).length;
      assert.ok(doors>=2,`${family.id}/${i}: ${yard.name} has ${doors} ways in`);
    }
    for(const c of p.components){
      const long=Math.max(c.bounds.w,c.bounds.d),short=Math.min(c.bounds.w,c.bounds.d);
      if(c.kind==='lodging'){lodging++;if(long>=short*1.5)longRanges++;}
      if(c.kind==='tower'){towers++;if(long<short*1.25)compact++;}
    }
  }
  assert.ok(withYard/plans>=0.6,`only ${withYard} of ${plans} compositions hold an open yard`);
  assert.ok(longRanges/Math.max(1,lodging)>=0.6,`only ${longRanges} of ${lodging} lodging ranges are ranges rather than blocks`);
  assert.ok(compact/Math.max(1,towers)>=0.5,`only ${compact} of ${towers} towers are compact`);
  assert.ok(programmes.size>=plans*0.5,`only ${programmes.size} distinct building programmes across ${plans} plans`);
});
void test('a range deeper than it is wide is walked along its length, not cut into two long strips',()=>{
  // A wing eighty blocks deep and twenty wide cannot be divided by a passage across it: both halves come
  // out as strips the length of the wing. Such a range takes one walk down its flank and a rank behind it.
  const p=generatePlan({...DEFAULT_SETTINGS,kind:'castle',family:'courtyard-castle',size:256,floors:2,seed:'GRAIN'});
  const wing=p.components.find(c=>c.kind==='domestic'&&c.bounds.d>=c.bounds.w*1.7);
  assert.ok(wing,'the courtyard castle has no deep residential range');
  const inWing=p.rooms.filter(r=>r.componentId===wing!.id&&r.floorY===0);
  const walk=inWing.find(r=>isCirculation(r)&&r.bounds.d>=wing!.bounds.d-1);
  assert.ok(walk,`no walk runs the length of the wing: ${inWing.filter(isCirculation).map(r=>`${r.name} ${r.bounds.w}x${r.bounds.d}`).join(', ')}`);
  // The rank behind it is a sequence of rooms, each of them a room rather than a band.
  const rank=inWing.filter(r=>!isCirculation(r));
  assert.ok(rank.length>=3,`the wing holds only ${rank.length} rooms behind its walk`);
  for(const r of rank)assert.ok(r.bounds.d<wing!.bounds.d/2,`${r.name} is ${r.bounds.w}x${r.bounds.d} in a wing ${wing!.bounds.d} deep`);
  // And the walk fronts the court, so the yard has an edge rather than a row of chamber walls.
  const court=p.rooms.find(r=>r.kind==='court')!;
  assert.ok(p.connections.some(([a,b])=>(a===walk!.id&&b===court.id)||(b===walk!.id&&a===court.id)),'the wing walk does not open onto the court');
});
void test('the hall is entered through its own screens, never off a passage in its flank',()=>{
  for(const settings of representatives){
    const p=generatePlan(settings);
    const hall=p.rooms.find(r=>r.kind==='hall')!;
    const doors=p.connections.filter(e=>e.includes(hall.id)).map(([a,b])=>p.rooms.find(r=>r.id===(a===hall.id?b:a))!);
    assert.ok(doors.some(r=>r.name==='Screens passage'),`${settings.seed}: the hall has no screens passage door`);
    // Any other door into the hall is at one of its ends — the dais, or the screens — never mid-flank.
    const b=hall.bounds,along=b.d>=b.w?'z':'x',lo=along==='z'?b.z:b.x,len=along==='z'?b.d:b.w;
    for(const o of p.openings.filter(o=>o.type==='door'&&o.roomIds.includes(hall.id))){
      const other=p.rooms.find(r=>r.id===o.roomIds.find(id=>id!==hall.id))!;
      if(other.componentId===hall.componentId)continue;
      const flank=(along==='z')!==(o.axis==='z');
      const at=along==='z'?o.z:o.x;
      if(!flank||at<=lo+7||at>=lo+len-8)continue;
      // Mid-flank is a last resort, cut only where a range has no other way into the house at all.
      assert.ok(isCirculation(other),`${settings.seed}: ${other.name} opens into the middle of the hall's flank`);
      const without={...p,connections:p.connections.filter(([a,b])=>!o.roomIds.includes(a)||!o.roomIds.includes(b))};
      assert.ok(accessGraph(without).unreachable.includes(other.id),`${settings.seed}: ${other.name} takes a mid-flank hall door it does not need`);
    }
  }
});
void test('a suite is entered as a set: its closet opens off its chamber, not off the corridor',()=>{
  // The critique this answers: "several guest wardrobes appear to open from shared passages rather than
  // directly from their associated guest chambers ... a poor default for storage belonging to a suite."
  let suites=0;
  for(const settings of representatives){
    const p=generatePlan(settings);
    const byId=new Map(p.rooms.map(r=>[r.id,r]));
    for(const suite of p.suites){
      suites++;
      const head=byId.get(suite.headId)!;
      assert.ok(head,`${settings.seed}: suite ${suite.id} has no chamber`);
      for(const id of suite.roomIds){
        if(id===suite.headId)continue;
        const member=byId.get(id)!;
        const doors=p.connections.filter(e=>e.includes(id)).map(([a,b])=>byId.get(a===id?b:a)!);
        assert.ok(doors.some(d=>d.id===head.id),`${settings.seed}: ${member.name} is not entered from ${head.name}`);
        assert.ok(!doors.some(isCirculation),`${settings.seed}: ${member.name} opens off ${doors.filter(isCirculation).map(d=>d.name).join(', ')}`);
        assert.equal(member.suiteId,suite.id);
      }
    }
    // Carrying your own closet is not being a corridor, and nothing else may be carried through a chamber.
    for(const t of navigationReport(p).transits)assert.fail(`${settings.seed}: ${t.name} carries ${t.strands.length} rooms`);
  }
  assert.ok(suites>=representatives.length,`only ${suites} suites across ${representatives.length} plans`);
});
void test('a defended enclosure is a building: wall mass, a gatehouse, and a yard that works',()=>{
  // The critique this answers: "the long walls, tiny corner-tower outlines and unresolved southern edge do
  // not communicate an inhabitable defensive structure ... where is the entrance through that enclosure?"
  const castle=generatePlan({...DEFAULT_SETTINGS,kind:'castle',family:'keep-bailey',size:200,floors:3,seed:'ENCLOSURE'});
  assert.ok(castle.courts.length>0,'a castle has no enclosure');
  for(const court of castle.courts){
    assert.ok(court.thickness>=2,`${court.name} curtain is ${court.thickness} block thick`);
    // The gate is a passage through the gatehouse, not a gap in a line.
    assert.ok(court.gatehouse.w>=court.thickness*3,`${court.name} gatehouse is too slight to pass through`);
    assert.ok(court.gate.x>court.gatehouse.x&&court.gate.x<court.gatehouse.x+court.gatehouse.w,'the gate is not in the gatehouse');
    assert.ok(court.gatehouse.z<=court.gate.z&&court.gatehouse.z+court.gatehouse.d>=court.gate.z,'the gatehouse does not straddle the curtain');
    // The curtain is really that thick in blocks, not just in the record.
    const wall=castle.walls.filter(w=>w.componentId===court.id&&w.y===0);
    assert.ok(wall.length>0,`${court.name} has no wall blocks`);
  }
  const inner=castle.courts[0];
  assert.ok(inner.yards.length>0,'the bailey is left as blank canvas');
  assert.ok(inner.well,'the household has no water in its yard');
  for(const yard of inner.yards){
    assert.ok(yard.bounds.w>=8&&yard.bounds.d>=8,`${yard.name} is too small to work in`);
    assert.ok(yard.bounds.x>=inner.bounds.x&&yard.bounds.x+yard.bounds.w<=inner.bounds.x+inner.bounds.w,`${yard.name} is outside the walls`);
  }
  // A kitchen is an installation, wherever it is: fire and oven, not a table and a token hearth.
  for(const settings of representatives){
    const p=generatePlan(settings);
    for(const kitchen of p.rooms.filter(r=>r.name==='Kitchen'&&r.bounds.w>=9&&r.bounds.d>=9)){
      const fittings=new Set(kitchen.furniture.map(f=>f.type));
      assert.ok(fittings.has('hearth')&&fittings.has('oven'),`${settings.seed}: the kitchen has no ${fittings.has('hearth')?'oven':'fire'}`);
    }
  }
  // The hall's long axis runs the way its ceremony does, and it has a head to the room.
  const hall=reference.rooms.find(r=>r.kind==='hall')!;
  assert.ok(hall.bounds.d>hall.bounds.w,`the hall is ${hall.bounds.w} across and only ${hall.bounds.d} deep`);
  const fittings=new Set(hall.furniture.map(f=>f.type));
  assert.ok(fittings.has('dais')&&fittings.has('hearth')&&fittings.has('table'),'the hall has no dais, hearth or table');
});
void test('the courtyard castle is organised by its site: gate, court, hall, services, private side',()=>{
  // The specification's reference composition: a southern gatehouse opens into a usable central court; the
  // hall occupies the northern range with its service end toward the kitchen and its high end toward the
  // private accommodation; the chapel is reachable without traversing private rooms.
  for(const size of [128,200,320,480])for(const floors of [2,4]){
    const settings={...DEFAULT_SETTINGS,kind:'castle' as const,family:'courtyard-castle' as const,size,floors,seed:`QUAD-${floors}`};
    const p=generatePlan(settings);
    const tag=`${size}/${floors}`;
    const court=p.rooms.find(r=>r.kind==='court');
    assert.ok(court,`${tag}: there is no court`);
    assert.ok(court!.bounds.w>=20&&court!.bounds.d>=20,`${tag}: the court is ${court!.bounds.w}x${court!.bounds.d}`);
    // Every range fronts the yard: the court is what joins them, not a chain of rooms.
    const onto=p.connections.filter(e=>e.includes(court!.id)).map(([a,b])=>p.rooms.find(r=>r.id===(a===court!.id?b:a))!);
    assert.ok(onto.length>=3,`${tag}: only ${onto.length} rooms open onto the court`);
    const gateRange=new Set(p.components.filter(c=>c.kind==='gatehouse').map(c=>c.id));
    const oddity=onto.filter(r=>!isCirculation(r)&&!gateRange.has(r.componentId));
    assert.deepEqual(oddity.map(r=>r.name),[],`${tag}: the court opens straight into ${oddity.map(r=>r.name).join(', ')}`);
    // You arrive through the gatehouse, cross the court, and enter the hall through its screens.
    const hall=p.rooms.find(r=>r.kind==='hall')!;
    const walk=routeToRoom(p,hall.id).map(r=>r.name);
    assert.ok(walk[0]?.startsWith('Gate'),`${tag}: the walk begins at ${walk[0]}`);
    assert.ok(walk.includes('Inner court'),`${tag}: the hall is reached without crossing the court: ${walk.join(' -> ')}`);
    assert.equal(walk[walk.length-2],'Screens passage',`${tag}: the hall is entered from ${walk[walk.length-2]}`);
    // The chapel is reached without passing through anybody's chamber.
    for(const chapel of p.rooms.filter(r=>r.kind==='sacred')){
      const crossed=routeToRoom(p,chapel.id).slice(0,-1).filter(r=>!isCirculation(r));
      assert.deepEqual(crossed.map(r=>r.name),[],`${tag}: the chapel is reached through ${crossed.map(r=>r.name).join(', ')}`);
    }
    assert.deepEqual(navigationReport(p).transits.map(t=>t.name),[],`${tag}: forced crossings`);
  }
  // A larger budget buys a larger quadrangle.
  const small=generatePlan({...DEFAULT_SETTINGS,kind:'castle',family:'courtyard-castle',size:128,floors:3,seed:'SCALE'});
  const large=generatePlan({...DEFAULT_SETTINGS,kind:'castle',family:'courtyard-castle',size:480,floors:3,seed:'SCALE'});
  assert.ok(large.totalArea>small.totalArea*1.5,`480 blocks buys ${large.totalArea} against ${small.totalArea} for 128`);
});

void test('a retained core is heavier than what was built against it',()=>{
  // The defect this answers: every range of every seat was the same masonry, the same rhythm and the same
  // window, because nothing in the plan recorded that a household builds against what is already standing.
  let inherited=0,single=0,heavier=0,coarser=0;
  const settings=(['house','manor','castle'] as const).flatMap(kind=>FAMILIES[kind].flatMap(f=>
    [128,256,384].map(size=>({...DEFAULT_SETTINGS,kind,size,floors:3,seed:`PHASE-${size}`,family:f.id}))));
  for(const s of settings){
    const p=generatePlan(s);
    const tag=`${s.kind}/${s.family}/${s.size}`;
    // A phase is a fact about every volume, and the builds a plan carries run without a gap.
    const builds=[...new Set(p.components.map(c=>c.phase))].sort((a,b)=>a-b);
    assert.ok(builds.every(n=>Number.isInteger(n)&&n>=0),`${tag}: a range belongs to no build`);
    assert.deepEqual(builds,builds.map((_,i)=>builds[0]+i),`${tag}: the builds skip one: ${builds.join(', ')}`);
    // Phase 0 is inherited fabric, so it only exists where something was later built against it.
    const core=p.components.filter(c=>c.phase===0);
    if(!core.length){single++;continue;}
    inherited++;
    assert.ok(p.components.some(c=>c.phase>0),`${tag}: a retained core with nothing standing against it`);
    // Nothing in a retained core is a timber frame: that is the later builds' lighter construction.
    const coreIds=new Set(core.map(c=>c.id));
    const frame=p.blocks.filter(b=>b.material===5&&coreIds.has(b.componentId));
    assert.equal(frame.length,0,`${tag}: ${frame.length} blocks of framing in the retained core`);
    // How far a range's masonry is carried outward past the footprint it was cut with.
    const plain=p.components.filter(c=>c.kind!=='court'&&c.polygon.length===4);
    const mass=new Map(plain.map(c=>[c.phase,0]));
    const projecting=p.articulation.filter(a=>a.role!=='niche').map(a=>a.bounds);
    for(const c of plain){
      let out=0;
      for(const b of p.blocks){
        if(b.componentId!==c.id||b.kind!=='wall')continue;
        // A bay stands proud of the wall on purpose; it is articulation, not the mass of the wall itself.
        if(projecting.some(r=>b.x>=r.x-1&&b.x<=r.x+r.w+1&&b.z>=r.z-1&&b.z<=r.z+r.d+1))continue;
        out=Math.max(out,c.bounds.x-b.x,b.x-(c.bounds.x+c.bounds.w),c.bounds.z-b.z,b.z-(c.bounds.z+c.bounds.d));
      }
      mass.set(c.phase,Math.max(mass.get(c.phase)??0,out));
    }
    const later=[...mass.entries()].filter(([n])=>n>0).map(([,m])=>m);
    if(mass.has(0)&&later.length&&mass.get(0)!>Math.max(...later))heavier++;
    // An older wall carries fewer, more widely spaced openings than the ranges added against it.
    const rhythms=new Map(p.components.map(c=>[c.phase,bayLines(c,s.kind==='castle').target]));
    if(rhythms.has(0)&&[...rhythms].some(([n,t])=>n>0&&t<rhythms.get(0)!))coarser++;
  }
  assert.ok(inherited>8,`only ${inherited} of ${settings.length} seats keep any inherited fabric`);
  assert.ok(single>8,`only ${single} of ${settings.length} seats were raised in one campaign`);
  assert.ok(heavier>=inherited*.8,`only ${heavier} of ${inherited} retained cores are heavier than their later ranges`);
  assert.ok(coarser>=inherited*.8,`only ${coarser} of ${inherited} retained cores take a coarser rhythm`);
});

void test('a projection has a reason, and keeps the promise the reason makes',()=>{
  // The defect this answers: walls that ran corner to corner without once stepping out of line, and the
  // only things that ever stood proud of one — a chimney, a tower — carrying no record of why they did.
  let seats=0,arches=0,carried=0,rooms=0,projections=0;
  for(const settings of representatives){
    const p=generatePlan(settings);
    const tag=settings.seed;
    const grid=voxelize(p);
    rooms+=p.rooms.length;
    assert.ok(p.articulation.length,`${tag}: nothing on this estate steps out of line`);
    for(const a of p.articulation){
      assert.ok(a.reason.length>10,`${tag}: ${a.role} at ${a.bounds.x},${a.bounds.z} carries no reason`);
      const c=p.components.find(x=>x.id===a.componentId);
      assert.ok(c,`${tag}: ${a.role} belongs to no range`);
      if(a.role==='chimney')continue;
      if(a.role==='niche'){
        // A niche is the inward case: it sits in the wall of its room and stops short of daylight.
        const room=p.rooms.find(r=>a.roomIds.includes(r.id))!;
        assert.ok(['hall','sacred','gallery'].includes(room.kind),`${tag}: a niche in the ${room.kind}`);
        assert.ok(a.bounds.w*a.bounds.d<=2,`${tag}: a niche ${a.bounds.w} by ${a.bounds.d} is a chamber`);
        continue;
      }
      projections++;
      const room=p.rooms.find(r=>a.roomIds.includes(r.id))!;
      assert.ok(['hall','gallery','study','bedroom'].includes(room.kind),`${tag}: a bay off the ${room.kind}`);
      assert.equal(room.floorY>0,a.role==='oriel',`${tag}: ${a.role} on floor ${room.floorY}`);
      // It stands proud of the range: part of its footprint is outside the walls it comes through.
      const b=a.bounds;
      assert.ok(b.x<c!.bounds.x||b.z<c!.bounds.z||b.x+b.w>c!.bounds.x+c!.bounds.w||b.z+b.d>c!.bounds.z+c!.bounds.d,
        `${tag}: the ${a.role} for ${room.name} does not project`);
      // It opens into the room it was built for, and there is a way through at head height.
      let open=false;
      for(let x=b.x+1;x<b.x+b.w;x++)for(let z=b.z+1;z<b.z+b.d;z++)if(!grid.material(x,a.baseY+2,z))open=true;
      assert.ok(open,`${tag}: the ${a.role} for ${room.name} is solid`);
      arches++;
      // The seat is the point of it, and it is in the projection rather than somewhere in the room.
      const seat=room.furniture.find(f=>f.type==='seat'&&f.x>=b.x&&f.x<=b.x+b.w&&f.z>=b.z&&f.z<=b.z+b.d);
      assert.ok(seat,`${tag}: the ${a.role} for ${room.name} has no seat in it`);
      seats++;
      if(a.role==='oriel'){
        // What carries an oriel is drawn on the storey below rather than left to the reader's charity.
        assert.ok(p.blocks.some(k=>k.kind==='support'&&k.y<a.baseY&&k.x<b.x+b.w&&k.x+k.w>b.x&&k.z<b.z+b.d&&k.z+k.d>b.z),
          `${tag}: the oriel for ${room.name} hangs on nothing`);
        carried++;
      }
    }
    // Two projections may not want the same ground, and none may stand on a range.
    for(let i=0;i<p.articulation.length;i++)for(let j=i+1;j<p.articulation.length;j++){
      const a=p.articulation[i],b=p.articulation[j];
      if(a.role==='niche'||b.role==='niche')continue;
      assert.ok(!intersects(a.bounds,b.bounds),`${tag}: the ${a.role} and the ${b.role} want the same ground`);
    }
    assert.deepEqual(auditArchitecture(p,grid),[],`${tag}: the audit rejects this plan`);
  }
  assert.ok(projections>=representatives.length,`only ${projections} projections across ${representatives.length} estates`);
  assert.equal(arches,projections);
  assert.equal(seats,projections);
  assert.ok(carried>0,'no oriel anywhere, so the overhang convention is never exercised');
  // Restraint is the rule: repeated ordinary rooms are what make the exceptions read as exceptions.
  assert.ok(projections/rooms<.05,`${projections} projections for ${rooms} rooms is not restraint`);
});
