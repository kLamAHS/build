import { componentFootprint, FITTINGS, insidePolygon, type Plan, type Rect, type Room, type Point, type RoomKind } from './model.ts';
import { voxelize, type SparseBlocks } from './voxels.ts';

/** Validate the constructed cells, not just the adjacency labels. */
export function auditArchitecture(plan:Plan,grid:SparseBlocks=voxelize(plan)):string[]{
  const issues:string[]=[];
  // A doorway has to be clear through the whole thickness of its wall, not only at the face it was cut in.
  // An outside wall stands two or three blocks thick, and a reveal cut through part of it is still a wall.
  for(const o of plan.openings.filter(o=>o.type!=='window'))for(let w=0;w<o.width;w++)for(let h=0;h<o.height;h++){
    const x=o.x+(o.axis==='z'?w:0),z=o.z+(o.axis==='x'?w:0);
    if(grid.material(x,o.y+h,z)){issues.push(`The ${o.type} at X ${o.x}, Z ${o.z} is obstructed.`);continue;}
    for(const dir of [1,-1])for(let step=1;step<=3;step++){
      const px=o.axis==='x'?x+dir*step:x,pz=o.axis==='z'?z+dir*step:z;
      if(!grid.material(px,o.y+h,pz))break;
      issues.push(`The ${o.type} at X ${o.x}, Z ${o.z} is walled up ${step} block${step===1?'':'s'} beyond its face.`);
      break;
    }
  }
  for(const st of plan.stairs)for(let j=0;j<6;j++)for(let w=0;w<2;w++){
    const x=st.bounds.x+3+w,z=st.bounds.z+3+j,y=st.fromY+j+1;
    if(!grid.material(x,y,z))issues.push('A stair tread is missing.');
    for(let h=1;h<=3;h++)if(grid.material(x,y+h,z))issues.push('A stair has less than three blocks of headroom.');
  }
  for(const r of plan.rooms){
    if(r.kind==='court')continue;
    const ports:Point[]=[];
    for(const o of plan.openings.filter(o=>o.type!=='window'&&o.roomIds.includes(r.id))){
      const near=o.axis==='x'?{x:o.x+1,z:o.z}:{x:o.x,z:o.z+1},far=o.axis==='x'?{x:o.x-2,z:o.z}:{x:o.x,z:o.z-2};
      ports.push(insidePolygon(near.x+1,near.z+1,r.polygon)?near:far);
    }
    for(const st of plan.stairs.filter(st=>st.roomIds.includes(r.id))){const l=st.landings[r.floorY===st.fromY?0:1];ports.push({x:l.x,z:l.z});}
    const reachable=roomRoutes(r,ports,grid);
    if(!reachable)issues.push(`${r.name} (${r.componentId}, Y ${r.floorY}) does not have a clear two-block route between its doors and landings.`);
  }
  // A minimum area alone is satisfied by a strip ninety blocks long, and a target with no ceiling lets a
  // pantry absorb a whole wing. An ordinary room that has become either is a composition failure, not a
  // room worth furnishing, so the candidate is rejected and another composition is tried.
  const ORDINARY:RoomKind[]=['bedroom','study','service','storage'];
  for(const r of plan.rooms){
    if(!ORDINARY.includes(r.kind))continue;
    const w=r.bounds.w-1,d=r.bounds.d-1,where=`${r.name} (${r.componentId}, Y ${r.floorY})`;
    if(Math.max(w,d)>Math.min(w,d)*3.2)issues.push(`${where} is a ${w} by ${d} strip rather than a room.`);
    if(w*d>760)issues.push(`${where} has swallowed ${w*d} blocks of its range.`);
  }
  // A door may not open onto a void. The route test would catch it as a missing floor, but a household
  // walking off a landing into the stair well deserves to be told what it is rather than that a route failed.
  for(const r of plan.rooms)for(const h of r.holes)for(const o of plan.openings){
    if(o.type==='window'||!o.roomIds.includes(r.id))continue;
    const near=o.axis==='x'?{x:o.x+1,z:o.z}:{x:o.x,z:o.z+1},far=o.axis==='x'?{x:o.x-2,z:o.z}:{x:o.x,z:o.z-2};
    const step=insidePolygon(near.x+1,near.z+1,r.polygon)?near:far;
    for(let dx=0;dx<2;dx++)for(let dz=0;dz<2;dz++)
      if(step.x+dx>=h.x&&step.x+dx<=h.x+h.w&&step.z+dz>=h.z&&step.z+dz<=h.z+h.d)
        issues.push(`The ${o.type} into ${r.name} (${r.componentId}, Y ${r.floorY}) opens onto the well the stair comes up through.`);
  }
  for(const c of plan.chimneys)for(let y=c.fromY;y<c.toY;y++)if(grid.material(c.bounds.x,y,c.bounds.z)!==8)issues.push('A chimney stack is discontinuous.');
  // Every articulation promises something, and the promise is what is checked. A bay that never opens into
  // the room it was built for is a buttress with windows in it; a niche that goes through its wall is a hole.
  for(const a of plan.articulation){
    if(a.role==='chimney')continue;
    if(a.role==='bay'||a.role==='oriel'){
      // A projection that has eaten the room it came out of is not a bay: the host keeps a core of its own.
      const host=plan.rooms.find(r=>a.roomIds.includes(r.id));
      const across=a.side==='n'||a.side==='s';
      const span=across?a.bounds.w:a.bounds.d,wall=host?(across?host.bounds.w:host.bounds.d):0;
      if(host&&span*2>wall)issues.push(`The ${a.role} at X ${a.bounds.x}, Z ${a.bounds.z} takes ${span} of ${wall} blocks of ${host.name}, leaving it no core.`);
    }
    if(a.role==='jetty'){
      // A jetty is carried on its joists, and the joists are drawn: without them it is a storey in mid-air.
      const b=a.bounds;
      if(!plan.blocks.some(k=>k.kind==='support'&&k.y<a.baseY&&k.y>=a.baseY-2&&k.x<b.x+b.w&&k.x+k.w>b.x&&k.z<b.z+b.d&&k.z+k.d>b.z))
        issues.push(`The jetty at X ${b.x}, Z ${b.z} oversails with nothing shown to carry it.`);
      continue;
    }
    const b=a.bounds,where=`The ${a.role} at X ${b.x}, Z ${b.z}`;
    const out=a.side==='n'?{x:0,z:-1}:a.side==='s'?{x:0,z:1}:a.side==='w'?{x:-1,z:0}:{x:1,z:0};
    if(!plan.rooms.some(r=>a.roomIds.includes(r.id))){issues.push(`${where} is recorded against no room.`);continue;}
    if(a.role==='niche'){
      for(let x=b.x;x<b.x+b.w;x++)for(let z=b.z;z<b.z+b.d;z++){
        if(grid.material(x,a.baseY,z))issues.push(`${where} is not hollow.`);
        if(!grid.material(x+out.x,a.baseY,z+out.z))issues.push(`${where} goes through its wall instead of into it.`);
      }
      continue;
    }
    // The wall the projection comes through, the floor it stands on, and the space between the two.
    const wall=out.z?{axis:'z' as const,at:out.z>0?b.z:b.z+b.d}:{axis:'x' as const,at:out.x>0?b.x:b.x+b.w};
    let arch=false,floor=false,room=false;
    for(let x=b.x+1;x<b.x+b.w;x++)for(let z=b.z+1;z<b.z+b.d;z++){
      if(grid.material(x,a.baseY-1,z))floor=true;
      if(!grid.material(x,a.baseY+1,z)&&!grid.material(x,a.baseY+2,z))room=true;
      const cell=wall.axis==='z'?grid.material(x,a.baseY+2,wall.at):grid.material(wall.at,a.baseY+2,z);
      if(!cell)arch=true;
    }
    if(!floor)issues.push(`${where} has no floor to stand on.`);
    if(!room)issues.push(`${where} projects but encloses nothing.`);
    if(!arch)issues.push(`${where} never opens into the room it was built for.`);
    if(a.role==='oriel'&&!plan.blocks.some(k=>k.kind==='support'&&k.y<a.baseY&&k.x<b.x+b.w&&k.x+k.w>b.x&&k.z<b.z+b.d&&k.z+k.d>b.z))
      issues.push(`${where} hangs over open ground with nothing shown to carry it.`);
  }
  // ---- Vertical composition. A reservation is a volume the storeys owe each other, so what may stand in one
  // is named by the reservation rather than decided by whichever floor was divided last.
  const carried=(a:Rect)=>plan.articulation.some(k=>(k.role==='jetty'||k.role==='oriel')&&k.bounds.x<a.x+a.w&&k.bounds.x+k.bounds.w>a.x&&k.bounds.z<a.z+a.d&&k.bounds.z+k.bounds.d>a.z);
  for(const v of plan.reservations)for(const r of plan.rooms){
    if(r.floorY<v.fromY||r.floorY>=v.toY)continue;
    if(!(v.bounds.x<r.bounds.x+r.bounds.w&&v.bounds.x+v.bounds.w>r.bounds.x&&v.bounds.z<r.bounds.z+r.bounds.d&&v.bounds.z+v.bounds.d>r.bounds.z))continue;
    const where=`${r.name} (Y ${r.floorY}) stands in ${v.name}`;
    if(v.kind==='hall'&&r.kind!=='gallery')issues.push(`${where}, which only a gallery may overlook.`);
    if(v.kind==='stair'&&r.kind!=='stairs'&&r.kind!=='circulation')issues.push(`${where}, which is the well a flight comes up through.`);
    if(v.kind==='court'&&r.kind!=='court'&&!carried(r.bounds))issues.push(`${where}, which is open to the sky.`);
    if(v.kind==='loggia'&&r.kind!=='circulation')issues.push(`${where}, which is a covered walk and not a room.`);
  }
  // A loggia is covered overhead and open down one side. Lose either and it is a corridor or a colonnade.
  for(const v of plan.reservations.filter(v=>v.kind==='loggia')){
    const b=v.bounds,mid={x:b.x+Math.floor(b.w/2),z:b.z+Math.floor(b.d/2)};
    // Covered means roofed, not floored: a walk under the rafters of a single-storey range is still covered,
    // so the test is that something stands over it somewhere in the roof above rather than at one height.
    let covered=false;
    for(let y=v.toY;y<=v.toY+14&&!covered;y++)if(grid.material(mid.x,y,mid.z))covered=true;
    if(!covered)issues.push(`${v.name} has nothing over it, so it is a yard and not a loggia.`);
    if(!v.side)continue;
    const across=v.side==='n'||v.side==='s';
    const edge=v.side==='n'?b.z:v.side==='s'?b.z+b.d:v.side==='w'?b.x:b.x+b.w;
    const from=across?b.x:b.z,run=across?b.w:b.d;
    let open=0;
    for(let i=1;i<run;i++)if(!grid.material(across?from+i:edge,v.fromY+2,across?edge:from+i))open++;
    if(open*2<run)issues.push(`${v.name} is open along ${open} of ${run} blocks, which is a wall with holes rather than an arcade.`);
  }
  // Every occupied upper room is carried by something: the storey below it, or a cantilever that says so.
  for(const r of plan.rooms){
    if(r.floorY<=0||r.kind==='court')continue;
    const c=plan.components.find(x=>x.id===r.componentId);
    const under=c&&componentFootprint(c,r.floorY-6,plan.family);
    if(under&&r.bounds.x>=under.x&&r.bounds.z>=under.z&&r.bounds.x+r.bounds.w<=under.x+under.w&&r.bounds.z+r.bounds.d<=under.z+under.d)continue;
    if(carried(r.bounds))continue;
    issues.push(`${r.name} (${r.componentId}, Y ${r.floorY}) stands over open air with nothing to carry it.`);
  }
  // A stair rises one storey, lands at both ends of that rise, and both landings are inside its own shaft.
  for(const st of plan.stairs){
    const b=st.bounds,where=`The stair ${st.id}`;
    if(st.toY-st.fromY!==6)issues.push(`${where} rises ${st.toY-st.fromY} blocks rather than one storey.`);
    if(st.landings.length!==2)issues.push(`${where} has ${st.landings.length} landings rather than one at each level.`);
    for(const l of st.landings)if(l.x<b.x||l.z<b.z||l.x+l.w>b.x+b.w||l.z+l.d>b.z+b.d)issues.push(`${where} has a landing outside its own shaft.`);
    if(!plan.rooms.some(r=>st.roomIds.includes(r.id)&&r.floorY===st.fromY)||!plan.rooms.some(r=>st.roomIds.includes(r.id)&&r.floorY===st.toY))
      issues.push(`${where} does not join a room at each of the levels it serves.`);
  }
  // A court is open exterior for its whole reserved height. An eave may oversail it — that is what an eave is
  // — but a floor or a roof carried across it is a yard with a lid on, whatever the reservation says.
  const EAVES=2;
  for(const v of plan.reservations.filter(v=>v.kind==='court')){
    const b=v.bounds,inner={x:b.x+EAVES,z:b.z+EAVES,w:b.w-2*EAVES,d:b.d-2*EAVES};
    if(inner.w<=0||inner.d<=0)continue;
    const over=plan.blocks.find(k=>(k.kind==='roof'||k.kind==='floor')&&k.y>=v.fromY&&k.y<v.toY
      &&k.x<inner.x+inner.w&&k.x+k.w>inner.x&&k.z<inner.z+inner.d&&k.z+k.d>inner.z);
    if(over)issues.push(`${v.name} is open to the sky, and ${over.kind==='roof'?'a roof':'a floor'} is carried across it at Y ${over.y}.`);
  }
  // A yard the household can get into only one way is not a court but a gap with a gate on it: an open space
  // belongs to a composition when the buildings round it address it and it is a way through.
  for(const c of plan.components.filter(c=>c.kind==='court')){
    const room=plan.rooms.find(r=>r.componentId===c.id);
    if(!room)continue;
    const ways=plan.connections.filter(e=>e.includes(room.id)).length;
    if(ways<2)issues.push(`${c.name} is entered ${ways?'one way':'no way'} only, so it is a dead end rather than a court.`);
  }
  // A fitting has real dimensions. A larger room gets more of them, or a different arrangement of them, and
  // never a bigger one: a bed scaled to its chamber is not a bed, and a board scaled to its hall is a shelf
  // with people sitting at it.
  for(const r of plan.rooms)for(const f of r.furniture){
    if(f.type==='dais')continue;
    const fitting=FITTINGS[f.type];
    if(!fitting)continue;
    if(Math.max(f.w,f.d)>fitting.long||Math.min(f.w,f.d)>fitting.short)
      issues.push(`The ${f.type} in ${r.name} is ${f.w} by ${f.d}, which is a ${f.type} stretched to its room.`);
    if(!fitting.clear)continue;
    // And it has a side you can stand on to use it. A window seat stands in its bay, which is floor the
    // room's own polygon does not cover, so the projection counts as the room there.
    const bay=plan.articulation.find(a=>(a.role==='bay'||a.role==='oriel')&&a.roomIds.includes(r.id)
      &&f.x>=a.bounds.x&&f.x<=a.bounds.x+a.bounds.w&&f.z>=a.bounds.z&&f.z<=a.bounds.z+a.bounds.d);
    const floorHere=(x:number,z:number)=>insidePolygon(x+.5,z+.5,r.polygon)
      ||(!!bay&&x>bay.bounds.x&&x<bay.bounds.x+bay.bounds.w&&z>bay.bounds.z&&z<bay.bounds.z+bay.bounds.d);
    const band=(dx:number,dz:number)=>{
      const side:Rect=dx?{x:dx>0?f.x+f.w:f.x-fitting.clear,z:f.z,w:fitting.clear,d:f.d}
        :{x:f.x,z:dz>0?f.z+f.d:f.z-fitting.clear,w:f.w,d:fitting.clear};
      for(let x=side.x;x<side.x+side.w;x++)for(let z=side.z;z<side.z+side.d;z++){
        if(!floorHere(x,z))return false;
        // A dais is the floor of the high end, so standing on it is not standing on the furniture.
        if(r.furniture.some(o=>o!==f&&o.type!=='dais'&&x>=o.x&&x<o.x+o.w&&z>=o.z&&z<o.z+o.d))return false;
      }
      return true;
    };
    if(!band(1,0)&&!band(-1,0)&&!band(0,1)&&!band(0,-1))
      issues.push(`The ${f.type} in ${r.name} has no side clear to use it from.`);
  }
  // A light belongs in a wall with open ground or a yard beyond it, and never in a mass of masonry. The
  // facade pass refuses both when it places one; this is what keeps a later stage from adding one that does.
  const level=new Map<number,Room[]>();
  for(const r of plan.rooms)level.set(r.floorY,[...(level.get(r.floorY)??[]),r]);
  for(const o of plan.openings.filter(o=>o.type==='window')){
    const room=plan.rooms.find(r=>r.id===o.roomIds[0]);
    if(!room)continue;
    const cells=Array.from({length:o.width},(_,w)=>({x:o.x+(o.axis==='z'?w:0),z:o.z+(o.axis==='x'?w:0)}));
    const others=(level.get(room.floorY)??[]).filter(r=>r.id!==room.id&&r.kind!=='court');
    if(cells.some(c=>others.some(r=>c.x>r.bounds.x&&c.x<r.bounds.x+r.bounds.w&&c.z>r.bounds.z&&c.z<r.bounds.z+r.bounds.d)))
      issues.push(`The light at X ${o.x}, Z ${o.z} is cut through a wall ${room.name} shares with the room behind it.`);
    if(room.furniture.some(f=>(f.type==='hearth'||f.type==='oven')&&cells.some(c=>c.x>=f.x-1&&c.x<=f.x+f.w&&c.z>=f.z-1&&c.z<=f.z+f.d)))
      issues.push(`The light at X ${o.x}, Z ${o.z} is cut through the fire in ${room.name}.`);
  }
  // ---- Motifs. What makes an arrangement that arrangement is checked, not assumed: a hall whose dais has
  // wandered out of its high end, or whose screens no longer stand at the serving end, is a long room with
  // furniture in it rather than a hall.
  const holds=(a:Rect,b:Rect)=>b.x>=a.x-1&&b.z>=a.z-1&&b.x+b.w<=a.x+a.w+1&&b.z+b.d<=a.z+a.d+1;
  for(const m of plan.motifs){
    const where=`The ${m.kind} motif (${m.variant})`;
    if(m.high.x<m.low.x+m.low.w&&m.high.x+m.high.w>m.low.x&&m.high.z<m.low.z+m.low.d&&m.high.z+m.high.d>m.low.z)
      issues.push(`${where} has both its ends in the same place.`);
    for(const port of m.ports){
      if(!plan.openings.some(o=>o.id===port.openingId))issues.push(`${where} has a ${port.role} port through no opening.`);
      if(!m.roomIds.includes(port.roomId))issues.push(`${where} has a ${port.role} port in a room outside it.`);
    }
    if(m.kind!=='hall')continue;
    const body=plan.rooms.find(r=>m.roomIds.includes(r.id)&&r.kind==='hall');
    if(!body){issues.push(`${where} has no hall in it.`);continue;}
    const long=Math.max(body.bounds.w,body.bounds.d)-1,short=Math.min(body.bounds.w,body.bounds.d)-1;
    if(long<short*1.35)issues.push(`${where} is ${long} by ${short}, which has no long axis to have ends on.`);
    const dais=body.furniture.find(f=>f.type==='dais');
    if(dais&&!holds(m.high,dais))issues.push(`${where} has its dais outside its high end.`);
    const screens=plan.rooms.find(r=>m.roomIds.includes(r.id)&&r.kind==='circulation');
    if(screens&&!holds(m.low,screens.bounds))issues.push(`${where} has its screens outside its serving end.`);
  }
  // A door may not open onto a void it was never meant to reach, whatever made the void.
  for(const o of plan.openings){
    if(o.type==='window')continue;
    for(const id of o.roomIds){
      const r=plan.rooms.find(x=>x.id===id);if(!r)continue;
      const near=o.axis==='x'?{x:o.x+1,z:o.z}:{x:o.x,z:o.z+1},far=o.axis==='x'?{x:o.x-2,z:o.z}:{x:o.x,z:o.z-2};
      const step=insidePolygon(near.x+1,near.z+1,r.polygon)?near:far;
      for(const v of plan.reservations){
        if(v.kind==='court'||r.floorY<v.fromY||r.floorY>=v.toY)continue;
        if(plan.rooms.some(o2=>o2.id===r.id&&(o2.kind==='gallery'||o2.kind==='stairs'||o2.kind==='circulation')))continue;
        for(let dx=0;dx<2;dx++)for(let dz=0;dz<2;dz++)
          if(step.x+dx>=v.bounds.x&&step.x+dx<v.bounds.x+v.bounds.w&&step.z+dz>=v.bounds.z&&step.z+dz<v.bounds.z+v.bounds.d)
            issues.push(`The ${o.type} into ${r.name} (Y ${r.floorY}) opens onto ${v.name.toLowerCase()}.`);
      }
    }
  }
  return [...new Set(issues)];
}
function roomRoutes(r:Room,ports:Point[],grid:SparseBlocks){
  if(!ports.length)return false;
  const b=r.bounds,w=b.w+1,d=b.d+1,visited=new Uint8Array(w*d),cache=new Uint8Array(w*d);
  const id=(p:Point)=>(p.z-b.z)*w+p.x-b.x;
  const walkable=(p:Point)=>{
    if(p.x<=b.x||p.z<=b.z||p.x+1>=b.x+b.w||p.z+1>=b.z+b.d)return false;
    const index=id(p);if(cache[index])return cache[index]===1;
    for(let dx=0;dx<2;dx++)for(let dz=0;dz<2;dz++){
      const x=p.x+dx,z=p.z+dz;if(!insidePolygon(x+.5,z+.5,r.polygon)||!grid.material(x,r.floorY,z)){cache[index]=2;return false;}
      for(let h=1;h<=3;h++)if(grid.material(x,r.floorY+h,z)){cache[index]=2;return false;}
    }
    cache[index]=1;return true;
  };
  if(ports.some(p=>!walkable(p)))return false;
  const queue=[ports[0]];visited[id(ports[0])]=1;
  for(let cursor=0;cursor<queue.length;cursor++){
    const p=queue[cursor];for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const next={x:p.x+dx,z:p.z+dz};if(walkable(next)&&!visited[id(next)]){visited[id(next)]=1;queue.push(next);}}
  }
  return ports.every(p=>visited[id(p)]);
}
