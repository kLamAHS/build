import { insidePolygon, type Plan, type Room, type Point } from './model.ts';
import { voxelize, type SparseBlocks } from './voxels.ts';

/** Validate the constructed cells, not just the adjacency labels. */
export function auditArchitecture(plan:Plan,grid:SparseBlocks=voxelize(plan)):string[]{
  const issues:string[]=[];
  for(const o of plan.openings.filter(o=>o.type!=='window'))for(let w=0;w<o.width;w++)for(let h=0;h<o.height;h++)if(grid.material(o.x+(o.axis==='z'?w:0),o.y+h,o.z+(o.axis==='x'?w:0)))issues.push(`The ${o.type} at X ${o.x}, Z ${o.z} is obstructed.`);
  for(const st of plan.stairs)for(let j=0;j<6;j++)for(let w=0;w<2;w++){
    const x=st.bounds.x+3+w,z=st.bounds.z+3+j,y=st.fromY+j+1;
    if(!grid.material(x,y,z))issues.push('A stair tread is missing.');
    for(let h=1;h<=3;h++)if(grid.material(x,y+h,z))issues.push('A stair has less than three blocks of headroom.');
  }
  for(const r of plan.rooms){
    const ports:Point[]=[];
    for(const o of plan.openings.filter(o=>o.type!=='window'&&o.roomIds.includes(r.id))){const b=r.bounds;ports.push(o.axis==='x'?{x:o.x===b.x?o.x+1:o.x-2,z:o.z}:{x:o.x,z:o.z===b.z?o.z+1:o.z-2});}
    for(const st of plan.stairs.filter(st=>st.roomIds.includes(r.id))){const l=st.landings[r.floorY===st.fromY?0:1];ports.push({x:l.x,z:l.z});}
    const reachable=roomRoutes(r,ports,grid);
    if(!reachable)issues.push(`${r.name} (${r.componentId}, Y ${r.floorY}) does not have a clear two-block route between its doors and landings.`);
  }
  for(const c of plan.chimneys)for(let y=c.fromY;y<c.toY;y++)if(grid.material(c.bounds.x,y,c.bounds.z)!==8)issues.push('A chimney stack is discontinuous.');
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
