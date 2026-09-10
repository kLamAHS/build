import { insidePolygon, type BuildingComponent, type Plan, type Rect, type Room } from './model.ts';

/**
 * How the volumes of a composition stand together, as distinct from how its rooms are reached. Navigation
 * asks whether you can get there; this asks whether the thing you are getting around is a building or a
 * chain of sheds. Each dimension is bounded on its own, so no one of them can buy off another.
 */
export type Composition={
  volumes:number;
  /** Volumes crossed from the hall to the furthest one. A straggling arm shows up here and nowhere else. */
  reach:number;
  /** What share of the ground the composition covers is actually built or deliberately open. */
  spread:number;
  /** Open spaces the composition holds and addresses, rather than what is left over outside the walls. */
  yards:number;
  /** The principal room against the median one. A household without a dominant space has no hierarchy. */
  hierarchy:number;
  /** The share of rooms with an outside wall. A room with none can never have a window. */
  frontage:number;
  score:number;
};

/**
 * Where the bays fall on a range's walls: a pier at each corner, then an even rhythm at about six blocks —
 * seven for a tower, heavier piers on a castle, and nothing inside a chamfered corner. One description,
 * used by the generator to place its openings and by the drawing to show where it put them.
 */
export function bayLines(c:BuildingComponent,castle:boolean){
  const chamfer=c.kind==='tower'?Math.min(4,Math.floor(c.bounds.w/5)):0;
  const pier=Math.max(castle?3:2,chamfer+1),target=c.kind==='tower'?7:6;
  const centres=(from:number,to:number)=>{
    const span=to-from-2*pier,out:number[]=[];
    if(span<4)return out;
    const count=Math.max(1,Math.round(span/target));
    for(let i=0;i<count;i++)out.push(from+pier+Math.round(span*(i+.5)/count));
    return out;
  };
  const b=c.bounds;
  return {pier,target,x:centres(b.x,b.x+b.w),z:centres(b.z,b.z+b.d)};
}

/** Two footprints share a wall when one's edge is the other's and they overlap along it. */
export function abut(a:Rect,b:Rect){
  const lapZ=Math.min(a.z+a.d,b.z+b.d)-Math.max(a.z,b.z),lapX=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
  return (lapZ>0&&(a.x+a.w===b.x||b.x+b.w===a.x))||(lapX>0&&(a.z+a.d===b.z||b.z+b.d===a.z));
}

/** Volumes crossed from the one the household is built round to the furthest one from it. */
function volumeReach(components:BuildingComponent[]){
  const start=components.find(c=>c.kind==='hall')??components[0];
  if(!start)return 0;
  const depth=new Map([[start.id,0]]),queue=[start];
  for(let i=0;i<queue.length;i++)for(const other of components){
    if(depth.has(other.id)||!abut(queue[i].bounds,other.bounds))continue;
    depth.set(other.id,depth.get(queue[i].id)!+1);queue.push(other);
  }
  // A volume nothing touches is as far away as the composition is long.
  return components.length===depth.size?Math.max(...depth.values()):components.length;
}

export function compositionReport(plan:Plan):Composition {
  const built=plan.components;
  const volumes=built.length;
  if(!volumes)return {volumes:0,reach:0,spread:0,yards:0,hierarchy:0,frontage:0,score:0};
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity,covered=0;
  for(const c of built){
    minX=Math.min(minX,c.bounds.x);minZ=Math.min(minZ,c.bounds.z);
    maxX=Math.max(maxX,c.bounds.x+c.bounds.w);maxZ=Math.max(maxZ,c.bounds.z+c.bounds.d);
    covered+=c.bounds.w*c.bounds.d;
  }
  const site=Math.max(1,(maxX-minX)*(maxZ-minZ));
  const yards=built.filter(c=>c.kind==='court').length;
  const rooms=plan.rooms.filter(r=>r.kind!=='circulation'&&r.kind!=='stairs'&&r.kind!=='court');
  const areas=rooms.map(r=>r.area).sort((a,b)=>a-b);
  const median=areas.length?areas[Math.floor(areas.length/2)]:1;
  const hierarchy=areas.length?areas[areas.length-1]/Math.max(1,median):0;
  // A room has frontage when one of its walls faces open ground rather than the inside of another room.
  // A yard counts as open ground: a chamber looking onto a court is as lit as one looking out of the house.
  const byLevel=new Map<number,Room[]>();
  for(const r of plan.rooms)byLevel.set(r.floorY,[...(byLevel.get(r.floorY)??[]),r]);
  let faced=0;
  for(const r of rooms){
    const b=r.bounds,level=byLevel.get(r.floorY)!;
    const faces:[number,number][]=[[b.x-.5,b.z+b.d/2],[b.x+b.w+.5,b.z+b.d/2],[b.x+b.w/2,b.z-.5],[b.x+b.w/2,b.z+b.d+.5]];
    // The bounds reject almost every room before the polygon test, which is what keeps this affordable.
    if(faces.some(([x,z])=>!level.some(o=>o.id!==r.id&&o.kind!=='court'
      &&x>o.bounds.x&&x<o.bounds.x+o.bounds.w&&z>o.bounds.z&&z<o.bounds.z+o.bounds.d
      &&insidePolygon(x,z,o.polygon))))faced++;
  }
  const frontage=rooms.length?faced/rooms.length:1;
  const reach=volumeReach(built);
  const score=Math.max(0,Math.min(100,Math.round(100
    -Math.min(30,Math.max(0,reach-3)*7)
    -Math.min(20,Math.max(0,.5-covered/site)*120)
    -Math.min(20,Math.max(0,.85-frontage)*80)
    -Math.min(15,Math.max(0,5-hierarchy)*4)
    +Math.min(10,yards*5))));
  return {volumes,reach,spread:Number((covered/site).toFixed(3)),yards,hierarchy:Number(hierarchy.toFixed(2)),frontage:Number(frontage.toFixed(3)),score};
}
